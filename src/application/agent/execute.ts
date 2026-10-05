import { canSetVisibility, canVoid } from "../../domain/access"
import { normalizeAlias } from "../../domain/alias"
import { civilDate, civilMonthRange, resolveWhen, startOfCivilDay } from "../../domain/dates"
import { formatEur } from "../../domain/money"
import { proposalFor, replyFor, summaryFor, type ReplyEvent } from "../../domain/reply"
import {
  amendSchema,
  recallSchema,
  rememberSchema,
  totalSchema,
  voidSchema,
  type AmendInput,
  type EntityRef,
  type RememberInput,
} from "../../domain/tools"
import type { EventSummary, EventType, Session, Visibility } from "../../domain/types"
import { warrantyEndsOn, warrantyReminderDueAt, warrantyReminderTitle } from "../../domain/warranty"
import type { Env } from "../../env"
import { dbFrom } from "../../infrastructure/d1/client"
import { sumAmount } from "../../infrastructure/d1/queries"
import { searchText } from "../../infrastructure/search"
import { searchEvents } from "../search/searchEvents"
import { writeDraft, type ProposalDraft } from "./confirm"
import { TIME_ZONE } from "./context"
import {
  drizzleDb,
  eventVisibility,
  findAlias,
  listVehicles,
  loadEventDetail,
  voidFact,
  type EntityHit,
} from "./sql"

const DEFAULT_CONFIRM_ABOVE_MINOR = 50_000
const RECALL_LIMIT = 12

type TurnMessage = { id: string; text: string; conversationId: string }

export type ToolOutcome =
  | { kind: "result"; payload: Record<string, unknown>; events: EventSummary[] }
  | { kind: "proposal"; reply: string; draft: ProposalDraft }

type PendingEntity =
  | { mode: "link"; entity: EntityHit }
  | { mode: "create"; kind: string; name: string; normalized: string }

type DraftOutcome = { error: Record<string, unknown> } | { draft: ProposalDraft; reply: ReplyEvent }

export async function executeTool(
  env: Env,
  session: Session,
  message: TurnMessage,
  call: { name: string; arguments: unknown },
  now: Date,
): Promise<ToolOutcome> {
  const args = stripHousehold(call.arguments)
  switch (call.name) {
    case "remember":
      return remember(env, session, message, args, now)
    case "amend":
      return amend(env, session, message, args, now)
    case "recall":
      return recall(env, session, args, now)
    case "total":
      return total(env, session, args, now)
    case "void":
      return voidEvent(env, session, args)
    default:
      return failure("unknown_tool", `Tool ${call.name} does not exist.`)
  }
}

async function remember(
  env: Env,
  session: Session,
  message: TurnMessage,
  args: unknown,
  now: Date,
): Promise<ToolOutcome> {
  const parsed = rememberSchema.safeParse(args)
  if (!parsed.success) return failure("validation", firstIssue(parsed.error))

  const built = await buildDraft(env, session, parsed.data, now, null)
  if ("error" in built) return { kind: "result", payload: built.error, events: [] }
  return settle(env, session, message, built)
}

async function amend(
  env: Env,
  session: Session,
  message: TurnMessage,
  args: unknown,
  now: Date,
): Promise<ToolOutcome> {
  const parsed = amendSchema.safeParse(args)
  if (!parsed.success) return failure("validation", firstIssue(parsed.error))

  const previous = await loadEventDetail(env.DB, session.householdId, parsed.data.eventId)
  if (!previous || previous.status !== "active") return failure("not_found", "No active event with that id.")
  if (!canVoid(session.role, previous.visibility, previous.actorId, session.userId)) {
    return failure("forbidden", "The speaker cannot change this event.")
  }

  const merged = mergeWithPrevious(parsed.data, previous)
  const built = await buildDraft(env, session, merged, now, {
    id: previous.id,
    version: previous.version,
    entity: previous.entity,
  })
  if ("error" in built) return { kind: "result", payload: built.error, events: [] }
  return settle(env, session, message, built)
}

async function settle(
  env: Env,
  session: Session,
  message: TurnMessage,
  built: { draft: ProposalDraft; reply: ReplyEvent },
): Promise<ToolOutcome> {
  const threshold = confirmAbove(env)
  if (built.draft.amountMinor != null && built.draft.amountMinor > threshold) {
    return { kind: "proposal", reply: proposalFor(built.reply), draft: built.draft }
  }
  const events = await writeDraft(env.DB, session, message.id, built.draft)
  const saved = events[0]
  return {
    kind: "result",
    payload: {
      saved: saved ? describe(saved) : null,
      entity: built.reply.entityName ?? null,
      supersededEventId: built.draft.supersedesEventId,
      reminder: built.draft.reminder ? { title: built.draft.reminder.title, dueAt: built.draft.reminder.dueAt } : null,
    },
    events,
  }
}

async function buildDraft(
  env: Env,
  session: Session,
  input: RememberInput,
  now: Date,
  corrects: { id: string; version: number; entity: EntityHit | null } | null,
): Promise<DraftOutcome> {
  const type = input.type
  const amountMinor = input.amountMinor ?? null

  if ((type === "expense" || type === "income") && amountMinor == null) {
    return { error: { error: "missing_amount", message: "Ask how much it was." } }
  }
  if (type === "warranty" && input.warrantyMonths == null) {
    return { error: { error: "missing_months", message: "Ask how many months of warranty." } }
  }
  if (type === "object.location" && !input.place) {
    return { error: { error: "missing_place", message: "Ask where the thing was put." } }
  }
  if (type === "reminder" && !input.remindAt) {
    return { error: { error: "validation", message: "Ask when to remind." } }
  }

  const resolved = await resolveEntities(env.DB, session, input.entities ?? [], corrects?.entity ?? null)
  let primary: PendingEntity | null = resolved[0] ?? null

  if (type === "vehicle.fuel" || type === "vehicle.maintenance") {
    const vehicle = await pickVehicle(env.DB, session, resolved)
    if ("error" in vehicle) return { error: vehicle.error }
    primary = vehicle.entity
  }

  const occurred = resolveWhen(input.occurredAt ?? "hoje", now, TIME_ZONE) ?? startOfCivilDay(now, TIME_ZONE)
  const occurredOn = civilDate(occurred, TIME_ZONE)
  const todayOn = civilDate(now, TIME_ZONE)

  let visibility: Visibility = input.visibility ?? "household"
  if (!canSetVisibility(session.role, visibility, session.userId, session.userId)) visibility = "household"

  const entityName = primary ? (primary.mode === "link" ? primary.entity.name : primary.name) : null
  const label = entityName ?? labelFor(type, input)

  let warrantyEnds: string | null = null
  let reminder: ProposalDraft["reminder"] = null
  if (input.warrantyMonths != null && (type === "warranty" || type === "purchase")) {
    warrantyEnds = warrantyEndsOn(occurredOn, input.warrantyMonths, TIME_ZONE)
    reminder = {
      title: warrantyReminderTitle(label ?? "compra"),
      dueAt: warrantyReminderDueAt(warrantyEnds, TIME_ZONE),
      audience: "adults",
    }
  }
  if (input.remindAt) {
    const due = resolveWhen(input.remindAt, now, TIME_ZONE)
    if (!due) return { error: { error: "validation", message: "The reminder date was not understood. Ask for a date." } }
    reminder = {
      title: input.text,
      dueAt: due.toISOString(),
      audience: visibility === "adults" ? "adults" : "household",
    }
  }

  const reply: ReplyEvent = {
    type,
    amountMinor,
    currency: amountMinor == null ? null : "EUR",
    entityName: label,
    place: input.place ?? null,
    text: type === "note" || type === "incident" ? input.text : null,
    title: type === "reminder" ? input.text : null,
    warrantyEndsOn: warrantyEnds,
    occurredOn,
    todayOn,
  }

  const data: Record<string, unknown> = { ...(input.details ?? {}), text: input.text }
  if (input.place) data.place = input.place
  if (input.warrantyMonths != null) data.warrantyMonths = input.warrantyMonths
  if (input.remindAt && reminder) data.remindAt = reminder.dueAt
  if (primary?.mode === "link") data.entityId = primary.entity.id
  const extraNames = resolved
    .filter((entry) => entry !== primary)
    .map((entry) => (entry.mode === "link" ? entry.entity.name : entry.name))
  if (extraNames.length > 0) data.otherEntities = extraNames

  const draft: ProposalDraft = {
    kind: "event",
    savedReply: replyFor(reply),
    type,
    occurredAt: occurred.toISOString(),
    visibility,
    version: corrects ? corrects.version + 1 : 1,
    amountMinor,
    currency: amountMinor == null ? null : "EUR",
    warrantyEndsOn: warrantyEnds,
    dataJson: JSON.stringify(data),
    supersedesEventId: corrects?.id ?? null,
    summary: summaryFor(reply),
    entity: primary
      ? primary.mode === "link"
        ? { mode: "link", id: primary.entity.id, role: primary.entity.kind }
        : { mode: "create", kind: primary.kind, name: primary.name, normalized: primary.normalized, role: primary.kind }
      : null,
    reminder,
  }
  return { draft, reply }
}

function mergeWithPrevious(input: AmendInput, previous: NonNullable<Awaited<ReturnType<typeof loadEventDetail>>>): RememberInput {
  const data = parseJson(previous.dataJson)
  const { eventId: _eventId, ...rest } = input
  return {
    ...rest,
    text: input.text ?? (typeof data.text === "string" ? data.text : previous.type),
    type: input.type ?? previous.type,
    occurredAt: input.occurredAt ?? previous.occurredAt,
    amountMinor: input.amountMinor ?? previous.amountMinor ?? undefined,
    visibility: input.visibility ?? previous.visibility,
    place: input.place ?? (typeof data.place === "string" ? data.place : undefined),
    warrantyMonths: input.warrantyMonths ?? (typeof data.warrantyMonths === "number" ? data.warrantyMonths : undefined),
    entities: input.entities,
  }
}

async function resolveEntities(
  db: D1Database,
  session: Session,
  refs: EntityRef[],
  inherited: EntityHit | null,
): Promise<PendingEntity[]> {
  const out: PendingEntity[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const normalized = normalizeAlias(ref.name)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    const existing = await findAlias(db, session.householdId, normalized)
    if (existing) out.push({ mode: "link", entity: existing })
    else out.push({ mode: "create", kind: ref.kind, name: ref.name.trim(), normalized })
  }
  if (out.length === 0 && inherited) out.push({ mode: "link", entity: inherited })
  return out
}

async function pickVehicle(
  db: D1Database,
  session: Session,
  resolved: PendingEntity[],
): Promise<{ entity: PendingEntity } | { error: Record<string, unknown> }> {
  const linked = resolved.find((entry) => entry.mode === "link" && entry.entity.kind === "vehicle")
  if (linked) return { entity: linked }

  const vehicles = await listVehicles(db, session.householdId)
  const named = resolved.find((entry) => entry.mode === "create" && entry.kind === "vehicle")
  if (named && named.mode === "create" && !isGenericVehicle(named.name)) {
    return { entity: named }
  }
  if (vehicles.length === 1) return { entity: { mode: "link", entity: vehicles[0]! } }
  if (vehicles.length >= 2) {
    return {
      error: {
        error: "ambiguous_vehicle",
        options: vehicles.map((vehicle) => vehicle.name),
        message: "Ask which vehicle it was.",
      },
    }
  }
  return { error: { error: "no_vehicle", message: "The household has no vehicle yet. Ask its name." } }
}

async function recall(env: Env, session: Session, args: unknown, now: Date): Promise<ToolOutcome> {
  const parsed = recallSchema.safeParse(args)
  if (!parsed.success) return failure("validation", firstIssue(parsed.error))
  const filter = parsed.data
  const limit = filter.limit ?? RECALL_LIMIT

  const from = filter.from ? resolveWhen(filter.from, now, TIME_ZONE)?.toISOString() : undefined
  const to = filter.to ? resolveWhen(filter.to, now, TIME_ZONE)?.toISOString() : undefined

  let entityId: string | undefined
  if (filter.entity) {
    const found = await findAlias(env.DB, session.householdId, normalizeAlias(filter.entity))
    if (!found) return { kind: "result", payload: { events: [], count: 0, note: `No entity named ${filter.entity}.` }, events: [] }
    entityId = found.id
  }

  let events: EventSummary[]
  if (filter.query) {
    events = (await searchText(env.DB, session, filter.query, env)).filter(
      (event) =>
        (!filter.type || event.type === filter.type) &&
        (!from || event.occurredAt >= from) &&
        (!to || event.occurredAt < to),
    )
  } else {
    events = await searchEvents(env.DB, session, { type: filter.type, entityId, from, to })
  }
  const page = events.slice(0, limit)
  return {
    kind: "result",
    payload: { events: page.map(describe), count: events.length },
    events: [],
  }
}

async function total(env: Env, session: Session, args: unknown, now: Date): Promise<ToolOutcome> {
  const parsed = totalSchema.safeParse(args)
  if (!parsed.success) return failure("validation", firstIssue(parsed.error))
  const filter = parsed.data
  const range = civilMonthRange(now, TIME_ZONE)
  const from = filter.from ? (resolveWhen(filter.from, now, TIME_ZONE)?.toISOString() ?? range.from) : range.from
  const to = filter.to ? (resolveWhen(filter.to, now, TIME_ZONE)?.toISOString() ?? range.to) : range.to
  const type: EventType = filter.type ?? "expense"

  let entityId: string | null = null
  let entityName: string | null = null
  if (filter.entity) {
    const found = await findAlias(env.DB, session.householdId, normalizeAlias(filter.entity))
    if (!found) {
      return {
        kind: "result",
        payload: { totalMinor: 0, formatted: formatEur(0), count: 0, type, from, to, entity: filter.entity, note: "No entity with that name." },
        events: [],
      }
    }
    entityId = found.id
    entityName = found.name
  }

  const totalMinor = await sumAmount(
    dbFrom(drizzleDb(env.DB)),
    session.householdId,
    type,
    entityId,
    from,
    to,
    eventVisibility(session),
  )
  const matched = await searchEvents(env.DB, session, { type, entityId: entityId ?? undefined, from, to })
  return {
    kind: "result",
    payload: {
      totalMinor,
      formatted: formatEur(totalMinor),
      count: matched.length,
      type,
      from: from.slice(0, 10),
      to: to.slice(0, 10),
      entity: entityName,
    },
    events: [],
  }
}

async function voidEvent(env: Env, session: Session, args: unknown): Promise<ToolOutcome> {
  const parsed = voidSchema.safeParse(args)
  if (!parsed.success) return failure("validation", firstIssue(parsed.error))
  const outcome = await voidFact(env, session, parsed.data.eventId)
  if (!outcome.ok) return failure(outcome.status === 403 ? "forbidden" : "not_found", outcome.message)
  return { kind: "result", payload: { voided: outcome.id }, events: [] }
}

function describe(event: EventSummary): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    date: event.occurredAt.slice(0, 10),
    amountMinor: event.amountMinor,
    amount: event.amountMinor == null ? null : formatEur(event.amountMinor),
    summary: event.summary,
    warrantyEndsOn: event.warrantyEndsOn,
  }
}

function labelFor(type: EventType, input: RememberInput): string | null {
  if (type === "purchase" || type === "income" || type === "warranty" || type === "object.location") {
    const product = typeof input.details?.product === "string" ? input.details.product.trim() : ""
    return product || null
  }
  return null
}

function confirmAbove(env: Env): number {
  const raw = Number(env.CONFIRM_ABOVE_MINOR)
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : DEFAULT_CONFIRM_ABOVE_MINOR
}

function failure(code: string, message: string): ToolOutcome {
  return { kind: "result", payload: { error: code, message }, events: [] }
}

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0]
  if (!issue) return "Invalid arguments."
  const path = issue.path.map(String).join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

function isGenericVehicle(name: string): boolean {
  return ["carro", "veiculo", "automovel", "viatura"].includes(normalizeAlias(name))
}

function stripHousehold(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  delete copy.householdId
  delete copy.household_id
  delete copy.actorId
  delete copy.actor_id
  return copy
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
