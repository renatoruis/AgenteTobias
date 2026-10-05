import { canSetVisibility } from "../../domain/access"
import { normalizeAlias } from "../../domain/alias"
import { civilDate, civilMonthRange, resolveWhen, startOfCivilDay } from "../../domain/dates"
import { toAmountMinor } from "../../domain/money"
import {
  missingAmountQuestion,
  replyFor,
  replyForClarification,
  replyForSum,
  summaryFor,
  type ReplyEvent,
} from "../../domain/reply"
import type { EventSummary, EventType, MessageResponse, Session, Visibility } from "../../domain/types"
import {
  askClarificationSchema,
  attachFileSchema,
  createReminderSchema,
  entityKindSchema,
  eventTypeSchema,
  recordEventSchema,
  resolveOrCreateEntitySchema,
  searchEventsSchema,
  searchTextSchema,
  voidEventSchema,
  type RecordEventInput,
} from "../../domain/tools"
import { warrantyEndsOn, warrantyReminderDueAt, warrantyReminderTitle } from "../../domain/warranty"
import type { Env } from "../../env"
import { dbFrom } from "../../infrastructure/d1/client"
import { sumAmount } from "../../infrastructure/d1/queries"
import { linkFile } from "../../infrastructure/r2"
import { searchEvents } from "../search/searchEvents"
import { searchText } from "../../infrastructure/search"
import { TIME_ZONE } from "./prompt"
import {
  createEntity,
  drizzleDb,
  eventInHousehold,
  eventVisibility,
  findAlias,
  findEntity,
  insertReminder,
  latestEventId,
  listVehicles,
  voidFact,
  writeFact,
  indexFact,
  retireFact,
  type EntityHit,
} from "./sql"

const GENERIC_VEHICLE = new Set(["carro", "veiculo", "automovel", "viatura"])

type TurnMessage = { id: string; text: string; conversationId: string }

export type ToolOutcome =
  | { kind: "done"; response: MessageResponse; terminal: "read" | "write" | "ask" }
  | { kind: "invalid" }

export async function executeTool(
  env: Env,
  session: Session,
  message: TurnMessage,
  call: { name: string; arguments: unknown },
  now: Date,
  corrects: { id: string; version: number } | null,
): Promise<ToolOutcome> {
  const args = stripHousehold(call.arguments)
  if (call.name === "record_event") return recordEvent(env, session, message, args, now, corrects)
  if (call.name === "ask_clarification") {
    const parsed = askClarificationSchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return done(ask(message, parsed.data.question), "ask")
  }
  if (call.name === "search_events") {
    const parsed = searchEventsSchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return done(await runSearchEvents(env, session, message, parsed.data, now), "read")
  }
  if (call.name === "search_text") {
    const parsed = searchTextSchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return done(await runSearchText(env, session, message, parsed.data.query), "read")
  }
  if (call.name === "void_event") {
    const parsed = voidEventSchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return done(await runVoid(env, session, message, parsed.data.eventId), "write")
  }
  if (call.name === "create_reminder") {
    const parsed = createReminderSchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return done(await runReminder(env, session, message, parsed.data, now), "write")
  }
  if (call.name === "attach_file") {
    const parsed = attachFileSchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return done(await runAttach(env, session, message, parsed.data.fileId), "write")
  }
  if (call.name === "resolve_or_create_entity") {
    const parsed = resolveOrCreateEntitySchema.safeParse(args)
    if (!parsed.success) return { kind: "invalid" }
    return runResolve(env, session, message, parsed.data.kind, parsed.data.name)
  }
  return { kind: "invalid" }
}

async function recordEvent(
  env: Env,
  session: Session,
  message: TurnMessage,
  rawArgs: unknown,
  now: Date,
  corrects: { id: string; version: number } | null,
): Promise<ToolOutcome> {
  const raw = asRecord(rawArgs)
  const data = asRecord(raw.data)
  const type = eventTypeSchema.safeParse(raw.type)
  if (!type.success) return { kind: "invalid" }

  if (data.currency != null && data.currency !== "EUR") {
    return done(ask(message, "Qual foi o valor em euros?"), "ask")
  }

  if (type.data === "expense") {
    const amount = coerceAmount(data.amountMinor ?? data.amount)
    if (amount == null) return done(ask(message, missingAmountQuestion()), "ask")
    data.amountMinor = amount
    data.currency = "EUR"
  } else {
    const amount = coerceAmount(data.amountMinor ?? data.amount)
    if (amount == null) {
      delete data.amountMinor
      delete data.amount
    } else {
      data.amountMinor = amount
      if (data.currency == null) data.currency = "EUR"
    }
  }

  const prepared = await prepareEntity(env, session, message.text, type.data, raw, data)
  if (prepared.kind === "ask") return done(ask(message, prepared.question), "ask")
  if (prepared.entity && needsEntityId(type.data)) data.entityId = prepared.entity.id

  if (type.data === "note" || type.data === "incident") {
    if (typeof data.text !== "string" || data.text.trim() === "") data.text = message.text
  }
  if (type.data === "warranty") {
    const months = readMonths(data.warrantyMonths)
    if (months == null) return done(ask(message, "Quantos meses de garantia?"), "ask")
    data.warrantyMonths = months
  }
  if (type.data === "object.location" && (typeof data.place !== "string" || data.place.trim() === "")) {
    return done(ask(message, "Onde ficou?"), "ask")
  }

  if (raw.entityKind != null && !entityKindSchema.safeParse(raw.entityKind).success) {
    delete raw.entityKind
  }

  const parsed = recordEventSchema.safeParse({ ...raw, data, type: type.data })
  if (!parsed.success) return { kind: "invalid" }
  const record = parsed.data

  let entity = prepared.entity
  if (!entity && record.entityName) {
    const kind = record.entityKind ?? defaultKind(record.type)
    const resolved = await resolveNamed(env.DB, session, message.text, record.entityName, kind)
    if (resolved.kind === "ask") return done(ask(message, resolved.question), "ask")
    entity = resolved.entity
  }

  let visibility: Visibility = record.visibility
  if (!canSetVisibility(session.role, visibility, session.userId, session.userId)) {
    visibility = "household"
  }

  const occurred = resolveWhen(record.occurredAt, now, TIME_ZONE) ?? startOfCivilDay(now, TIME_ZONE)
  const months = warrantyMonths(record, data)
  let warrantyEnds: string | null = null
  let reminder: { title: string; dueAt: string; audience: "adults" } | null = null
  if (months != null && (record.type === "warranty" || record.type === "purchase")) {
    const ends = warrantyEndsOn(civilDate(occurred, TIME_ZONE), months, TIME_ZONE)
    warrantyEnds = ends
    const label = entity?.name ?? record.entityName ?? "compra"
    reminder = {
      title: warrantyReminderTitle(label),
      dueAt: warrantyReminderDueAt(ends, TIME_ZONE),
      audience: "adults",
    }
  }

  const amountMinor = amountOn(record)
  const replyEvent: ReplyEvent = {
    type: record.type,
    amountMinor,
    currency: amountMinor == null ? null : "EUR",
    entityName: entity?.name ?? record.entityName ?? null,
    place: placeOn(record),
    text: textOn(record),
    title: titleOn(record),
    warrantyEndsOn: warrantyEnds,
  }
  const summary = summaryFor(replyEvent)
  const reply = replyFor(replyEvent)
  const eventId = await writeFact(env.DB, {
    householdId: session.householdId,
    messageId: message.id,
    actorId: session.userId,
    type: record.type,
    occurredAt: occurred.toISOString(),
    visibility,
    version: corrects ? corrects.version + 1 : 1,
    amountMinor,
    currency: amountMinor == null ? null : "EUR",
    warrantyEndsOn: warrantyEnds,
    dataJson: JSON.stringify(record.data),
    supersedesEventId: corrects?.id ?? null,
    summary,
    entityId: entity?.id ?? null,
    entityRole: entity?.kind ?? null,
    reminder,
  })
  await indexFact(env.DB, eventId)
  if (corrects) await retireFact(env.DB, corrects.id)

  const summaryEvent: EventSummary = {
    id: eventId,
    type: record.type,
    occurredAt: occurred.toISOString(),
    amountMinor,
    currency: amountMinor == null ? null : "EUR",
    summary,
    warrantyEndsOn: warrantyEnds,
  }
  return done(interpreted(message, reply, [summaryEvent]), "write")
}

async function prepareEntity(
  env: Env,
  session: Session,
  text: string,
  type: EventType,
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<{ kind: "entity"; entity: EntityHit | null } | { kind: "ask"; question: string }> {
  if (!needsEntityId(type)) return { kind: "entity", entity: null }
  const name = typeof raw.entityName === "string" ? raw.entityName : undefined
  const given = typeof data.entityId === "string" ? data.entityId : undefined
  if (type === "vehicle.fuel" || type === "vehicle.maintenance") {
    return resolveVehicle(env.DB, session, text, name, given)
  }
  if (name) return resolveNamed(env.DB, session, text, name, defaultKind(type))
  if (given) {
    const found = await findEntity(env.DB, session.householdId, given)
    if (found) return { kind: "entity", entity: found }
  }
  if (type === "object.location") return { kind: "ask", question: "Onde ficou?" }
  return { kind: "ask", question: "Qual é o nome?" }
}

async function resolveVehicle(
  db: D1Database,
  session: Session,
  text: string,
  name: string | undefined,
  entityId: string | undefined,
): Promise<{ kind: "entity"; entity: EntityHit | null } | { kind: "ask"; question: string }> {
  if (entityId) {
    const found = await findEntity(db, session.householdId, entityId)
    if (found?.kind === "vehicle") return { kind: "entity", entity: found }
  }

  if (name && !isGenericVehicle(name)) {
    const named = await resolveNamed(db, session, text, name, "vehicle")
    if (named.kind === "ask") return named
    if (named.entity?.kind === "vehicle") return named
  }

  const vehicles = await listVehicles(db, session.householdId)
  const namedInText = vehicles.filter(
    (vehicle) => mentioned(vehicle.normalized, normalizeAlias(text)) && !isGenericVehicle(vehicle.name),
  )
  if (namedInText.length === 1) return { kind: "entity", entity: namedInText[0] ?? null }
  if (namedInText.length >= 2) {
    return { kind: "ask", question: replyForClarification(namedInText[0]!.name, namedInText[1]!.name) }
  }

  const generic = (name != null && isGenericVehicle(name)) || mentionsGenericCar(text)
  if (generic || vehicles.length > 0) {
    if (vehicles.length >= 2) {
      return { kind: "ask", question: replyForClarification(vehicles[0]!.name, vehicles[1]!.name) }
    }
    if (vehicles.length === 1) return { kind: "entity", entity: vehicles[0] ?? null }
  }
  return { kind: "ask", question: "Qual foi o carro?" }
}

async function resolveNamed(
  db: D1Database,
  session: Session,
  text: string,
  name: string,
  kind: string,
): Promise<{ kind: "entity"; entity: EntityHit | null } | { kind: "ask"; question: string }> {
  const normalized = normalizeAlias(name)
  if (!normalized) return { kind: "entity", entity: null }
  const existing = await findAlias(db, session.householdId, normalized)
  if (existing) return { kind: "entity", entity: existing }
  if (isGenericVehicle(normalized) || (kind === "vehicle" && mentionsGenericCar(text) && isGenericVehicle(name))) {
    return resolveVehicle(db, session, text, name, undefined)
  }
  try {
    const created = await createEntity(db, session.householdId, kind, name.trim(), normalized)
    return { kind: "entity", entity: created }
  } catch {
    const again = await findAlias(db, session.householdId, normalized)
    if (again) return { kind: "entity", entity: again }
    return { kind: "ask", question: "Qual é o nome?" }
  }
}

async function runResolve(
  env: Env,
  session: Session,
  message: TurnMessage,
  kind: string,
  name: string,
): Promise<ToolOutcome> {
  const resolved = await resolveNamed(env.DB, session, message.text, name, kind)
  if (resolved.kind === "ask") return done(ask(message, resolved.question), "ask")
  if (!resolved.entity) return { kind: "invalid" }
  const reply = replyFor({
    type: "note",
    entityName: resolved.entity.name,
    text: resolved.entity.name,
  })
  return done(interpreted(message, reply, []), "write")
}

async function runSearchEvents(
  env: Env,
  session: Session,
  message: TurnMessage,
  filter: { type?: EventType; entityId?: string; entityName?: string; from?: string; to?: string },
  now: Date,
): Promise<MessageResponse> {
  const range = civilMonthRange(now, TIME_ZONE)
  const from = filter.from ? (resolveWhen(filter.from, now, TIME_ZONE)?.toISOString() ?? range.from) : range.from
  const to = filter.to ? (resolveWhen(filter.to, now, TIME_ZONE)?.toISOString() ?? range.to) : range.to
  const type = filter.type ?? "expense"

  let entityId: string | null = null
  let entityName = filter.entityName?.trim() || null
  if (filter.entityId) {
    const found = await findEntity(env.DB, session.householdId, filter.entityId)
    if (!found) return interpreted(message, replyForSum(0, entityName), [])
    entityId = found.id
    entityName = found.name
  } else if (entityName) {
    const found = await findAlias(env.DB, session.householdId, normalizeAlias(entityName))
    if (!found) return interpreted(message, replyForSum(0, entityName), [])
    entityId = found.id
    entityName = found.name
  }

  const total = await sumAmount(
    dbFrom(drizzleDb(env.DB)),
    session.householdId,
    type,
    entityId,
    from,
    to,
    eventVisibility(session),
  )
  const events = await searchEvents(env.DB, session, {
    type,
    entityId: entityId ?? undefined,
    from,
    to,
  })
  const reply = events.length === 0 ? replyForSum(0, entityName) : replyForSum(total, entityName)
  return interpreted(message, reply, events)
}

async function runSearchText(
  env: Env,
  session: Session,
  message: TurnMessage,
  query: string,
): Promise<MessageResponse> {
  const events = await searchText(env.DB, session, query, env)
  const reply = events.length === 0 ? "Não encontrei." : events.map((event) => event.summary).join(". ")
  return interpreted(message, reply, events)
}

async function runVoid(
  env: Env,
  session: Session,
  message: TurnMessage,
  eventId: string,
): Promise<MessageResponse> {
  const outcome = await voidFact(env, session, eventId)
  if (!outcome.ok) return ask(message, "Não encontrei.")
  return interpreted(message, "Anulei.", [])
}

async function runReminder(
  env: Env,
  session: Session,
  message: TurnMessage,
  input: { title: string; dueAt: string; audience: "household" | "adults"; eventId?: string | null },
  now: Date,
): Promise<MessageResponse> {
  const due = resolveWhen(input.dueAt, now, TIME_ZONE) ?? startOfCivilDay(now, TIME_ZONE)
  let eventId: string | null = null
  if (input.eventId && (await eventInHousehold(env.DB, session.householdId, input.eventId))) {
    eventId = input.eventId
  }
  await insertReminder(env.DB, {
    householdId: session.householdId,
    eventId,
    title: input.title,
    dueAt: due.toISOString(),
    audience: input.audience,
  })
  return interpreted(message, replyFor({ type: "reminder", title: input.title }), [])
}

async function runAttach(
  env: Env,
  session: Session,
  message: TurnMessage,
  fileId: string,
): Promise<MessageResponse> {
  const eventId = await latestEventId(env.DB, session.householdId, message.conversationId)
  if (!eventId) return ask(message, "Não encontrei.")
  const linked = await linkFile(env.DB, session, fileId, eventId)
  if (!linked) return ask(message, "Não encontrei o ficheiro.")
  return interpreted(message, "Ficheiro ligado.", [])
}

function interpreted(message: TurnMessage, reply: string, events: EventSummary[]): MessageResponse {
  return {
    messageId: message.id,
    conversationId: message.conversationId,
    status: "interpreted",
    reply,
    events,
    clarification: null,
    idempotent: false,
  }
}

function ask(message: TurnMessage, question: string): MessageResponse {
  return {
    messageId: message.id,
    conversationId: message.conversationId,
    status: "clarification",
    reply: question,
    events: [],
    clarification: { question },
    idempotent: false,
  }
}

function done(response: MessageResponse, terminal: "read" | "write" | "ask"): ToolOutcome {
  return { kind: "done", response, terminal }
}

function needsEntityId(type: EventType): boolean {
  return (
    type === "vehicle.fuel" ||
    type === "vehicle.maintenance" ||
    type === "warranty" ||
    type === "object.location"
  )
}

function defaultKind(type: EventType): string {
  if (type === "expense") return "merchant"
  if (type === "vehicle.fuel" || type === "vehicle.maintenance") return "vehicle"
  if (type === "warranty" || type === "purchase") return "appliance"
  return "other"
}

function warrantyMonths(record: RecordEventInput, rawData: Record<string, unknown>): number | null {
  if (record.type === "warranty") return record.data.warrantyMonths
  if (record.type === "purchase") return readMonths(rawData.warrantyMonths)
  return null
}

function amountOn(record: RecordEventInput): number | null {
  if (!("amountMinor" in record.data)) return null
  const value = record.data.amountMinor
  return typeof value === "number" ? value : null
}

function placeOn(record: RecordEventInput): string | null {
  if (record.type !== "object.location") return null
  return record.data.place
}

function textOn(record: RecordEventInput): string | null {
  if (record.type !== "note" && record.type !== "incident") return null
  return record.data.text
}

function titleOn(record: RecordEventInput): string | null {
  if (record.type !== "reminder") return null
  return record.data.title
}

function coerceAmount(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null
    if (Number.isSafeInteger(value)) return toAmountMinor(value)
    return toAmountMinor(String(value))
  }
  if (typeof value === "string") return toAmountMinor(value)
  return null
}

function readMonths(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1200) return value
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const months = Number(value.trim())
    if (months > 0 && months <= 1200) return months
  }
  return null
}

function isGenericVehicle(name: string): boolean {
  return GENERIC_VEHICLE.has(normalizeAlias(name))
}

function mentionsGenericCar(text: string): boolean {
  return normalizeAlias(text).split(" ").includes("carro")
}

function mentioned(alias: string, folded: string): boolean {
  if (alias.length < 2) return false
  let from = 0
  while (from < folded.length) {
    const index = folded.indexOf(alias, from)
    if (index < 0) return false
    const before = index === 0 || !/[a-z0-9]/.test(folded[index - 1] ?? "")
    const afterIndex = index + alias.length
    const after = afterIndex >= folded.length || !/[a-z0-9]/.test(folded[afterIndex] ?? "")
    if (before && after) return true
    from = index + 1
  }
  return false
}

function stripHousehold(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const copy: Record<string, unknown> = { ...asRecord(value) }
  delete copy.householdId
  delete copy.household_id
  const data = copy.data
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = { ...asRecord(data) }
    delete inner.householdId
    delete inner.household_id
    copy.data = inner
  }
  return copy
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
