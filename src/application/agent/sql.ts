import { and, eq, inArray, or, type SQL } from "drizzle-orm"
import { canRead, canVoid, readScope } from "../../domain/access"
import { startOfCivilDay } from "../../domain/dates"
import type { EventSummary, EventType, Session, Visibility } from "../../domain/types"
import type { Env } from "../../env"
import { events } from "../../infrastructure/d1/schema"
import { deleteIfOrphan } from "../../infrastructure/r2"
import { indexEvent } from "../../infrastructure/search"
import { CARD_ENTITY_LIMIT, TIME_ZONE, TODAY_LIMIT, type HouseholdCard, type Turn } from "./context"
import { AgentError } from "./errors"

/** Drizzle's D1 driver reads rows with `raw()`. The test double only has `all()`. */
export function drizzleDb(database: D1Database): D1Database {
  return new Proxy(database, {
    get(target, prop, receiver) {
      if (prop !== "prepare") return Reflect.get(target, prop, receiver)
      const prepare = Reflect.get(target, prop, receiver) as D1Database["prepare"]
      return (query: string) => {
        const statement = prepare.call(target, query)
        const bind = statement.bind.bind(statement)
        return new Proxy(statement, {
          get(stmt, key, recv) {
            if (key !== "bind") return Reflect.get(stmt, key, recv)
            return (...params: unknown[]) => {
              const bound = bind(...params)
              if (typeof (bound as { raw?: unknown }).raw === "function") return bound
              return new Proxy(bound, {
                get(row, rowKey, rowRecv) {
                  if (rowKey !== "raw") return Reflect.get(row, rowKey, rowRecv)
                  return async () => {
                    const listed = await row.all<Record<string, unknown>>()
                    return (listed.results ?? []).map((item) => Object.values(item))
                  }
                },
              })
            }
          },
        })
      }
    },
  })
}

export type EntityHit = { id: string; name: string; kind: string; normalized: string }

export type StoredEvent = {
  id: string
  type: EventType
  occurredAt: string
  amountMinor: number | null
  currency: string | null
  summary: string
  warrantyEndsOn: string | null
  entityName: string | null
}

type EventAccess = {
  id: string
  actorId: string
  visibility: Visibility
  status: string
  version: number
}

export function eventVisibility(session: Session): SQL {
  const scope = readScope(session.role)
  if (scope.visibilities.includes("private")) {
    return inArray(events.visibility, scope.visibilities)
  }
  const shared = inArray(events.visibility, scope.visibilities)
  const ownPrivate = and(eq(events.visibility, "private"), eq(events.actorId, session.userId))
  return or(shared, ownPrivate) ?? shared
}

export async function openConversation(
  db: D1Database,
  session: Session,
  requested: string | undefined,
  now: Date,
): Promise<{ id: string; created: boolean }> {
  if (requested) {
    const found = await db
      .prepare("SELECT id FROM conversations WHERE id = ? AND household_id = ?")
      .bind(requested, session.householdId)
      .first<{ id: string }>()
    if (!found) throw new AgentError(404, "not_found", "Não encontrei.")
    return { id: requested, created: false }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      "INSERT INTO conversations (id, household_id, user_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, session.householdId, session.userId, now.toISOString())
    .run()
  return { id, created: true }
}

export async function dropConversation(db: D1Database, householdId: string, id: string): Promise<void> {
  await db
    .prepare("DELETE FROM conversations WHERE id = ? AND household_id = ?")
    .bind(id, householdId)
    .run()
}

/** Previous turns of this conversation: who spoke, what they said, and what Tobias replied. */
export async function recentTurns(
  db: D1Database,
  session: Session,
  conversationId: string,
  skipMessageId: string,
  limit: number,
): Promise<Turn[]> {
  const listed = await db
    .prepare(
      `SELECT m.id AS id, m.text AS text, m.created_at AS created_at, m.result_json AS result_json,
              u.display_name AS speaker, e.visibility AS visibility, e.actor_id AS actor_id
       FROM messages m
       JOIN users u ON u.id = m.actor_id
       LEFT JOIN events e ON e.message_id = m.id AND e.household_id = m.household_id
       WHERE m.household_id = ? AND m.conversation_id = ? AND m.id != ?
       ORDER BY m.created_at DESC
       LIMIT 80`,
    )
    .bind(session.householdId, conversationId, skipMessageId)
    .all<{
      id: string
      text: string
      created_at: string
      result_json: string | null
      speaker: string
      visibility: string | null
      actor_id: string | null
    }>()

  const grouped = new Map<string, Turn & { hidden: boolean }>()
  const order: string[] = []
  for (const row of listed.results) {
    const current = grouped.get(row.id) ?? {
      speaker: row.speaker,
      text: row.text,
      reply: replyFromResult(row.result_json),
      hidden: false,
    }
    if (!grouped.has(row.id)) order.push(row.id)
    if (row.visibility && isVisibility(row.visibility)) {
      const actorId = row.actor_id ?? ""
      if (!canRead(session.role, row.visibility, actorId, session.userId)) current.hidden = true
    }
    grouped.set(row.id, current)
  }

  const turns: Turn[] = []
  for (const id of order) {
    if (turns.length >= limit) break
    const item = grouped.get(id)
    if (!item || item.hidden) continue
    turns.push({ speaker: item.speaker, text: item.text, reply: item.reply })
  }
  return turns.reverse()
}

export async function householdCard(db: D1Database, session: Session): Promise<HouseholdCard> {
  const household = await db
    .prepare("SELECT name FROM households WHERE id = ?")
    .bind(session.householdId)
    .first<{ name: string }>()
  const members = await db
    .prepare(
      `SELECT display_name AS name, role, phone FROM users
       WHERE household_id = ? AND removed_at IS NULL
       ORDER BY created_at`,
    )
    .bind(session.householdId)
    .all<{ name: string; role: string; phone: string | null }>()
  const links = await db
    .prepare("SELECT label, url FROM links WHERE household_id = ? ORDER BY label")
    .bind(session.householdId)
    .all<{ label: string; url: string }>()
  const entities = await db
    .prepare(
      `SELECT name, kind FROM entities
       WHERE household_id = ? AND status = 'active'
       ORDER BY kind, name
       LIMIT ?`,
    )
    .bind(session.householdId, CARD_ENTITY_LIMIT)
    .all<{ name: string; kind: string }>()
  return {
    name: household?.name ?? "Casa",
    members: members.results,
    entities: entities.results,
    links: links.results,
  }
}

export async function speakerName(db: D1Database, session: Session): Promise<string> {
  const row = await db
    .prepare("SELECT display_name AS name FROM users WHERE id = ? AND household_id = ?")
    .bind(session.userId, session.householdId)
    .first<{ name: string }>()
  return row?.name ?? "alguém"
}

/** Active events of today's civil day in Lisbon, visible to this speaker. */
export async function todayEvents(db: D1Database, session: Session, now: Date): Promise<EventSummary[]> {
  const from = startOfCivilDay(now, TIME_ZONE)
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000)
  const listed = await db
    .prepare(
      `SELECT id, type, occurred_at, amount_minor, currency, summary, warranty_ends_on, visibility, actor_id
       FROM events
       WHERE household_id = ? AND status = 'active' AND occurred_at >= ? AND occurred_at < ?
       ORDER BY occurred_at DESC
       LIMIT ?`,
    )
    .bind(session.householdId, from.toISOString(), to.toISOString(), TODAY_LIMIT)
    .all<{
      id: string
      type: EventType
      occurred_at: string
      amount_minor: number | null
      currency: string | null
      summary: string
      warranty_ends_on: string | null
      visibility: string
      actor_id: string
    }>()
  return listed.results
    .filter((row) => isVisibility(row.visibility) && canRead(session.role, row.visibility, row.actor_id, session.userId))
    .map((row) => ({
      id: row.id,
      type: row.type,
      occurredAt: row.occurred_at,
      amountMinor: row.amount_minor,
      currency: row.currency,
      summary: row.summary,
      warrantyEndsOn: row.warranty_ends_on,
    }))
}

function replyFromResult(json: string | null): string | null {
  if (!json) return null
  try {
    const body = JSON.parse(json) as { reply?: unknown }
    return typeof body.reply === "string" && body.reply.trim() !== "" ? body.reply : null
  } catch {
    return null
  }
}

export async function findAlias(
  db: D1Database,
  householdId: string,
  normalized: string,
): Promise<EntityHit | null> {
  return db
    .prepare(
      `SELECT e.id AS id, e.name AS name, e.kind AS kind, a.normalized AS normalized
       FROM aliases a
       JOIN entities e ON e.id = a.entity_id
       WHERE a.household_id = ? AND a.normalized = ? AND e.household_id = ?`,
    )
    .bind(householdId, normalized, householdId)
    .first<EntityHit>()
}

export async function listVehicles(db: D1Database, householdId: string): Promise<EntityHit[]> {
  const listed = await db
    .prepare(
      `SELECT e.id AS id, e.name AS name, e.kind AS kind, a.normalized AS normalized
       FROM entities e
       JOIN aliases a ON a.entity_id = e.id AND a.household_id = e.household_id
       WHERE e.household_id = ? AND e.kind = 'vehicle' AND e.status = 'active'
       ORDER BY e.name`,
    )
    .bind(householdId)
    .all<EntityHit>()
  return listed.results
}

export async function createEntity(
  db: D1Database,
  householdId: string,
  kind: string,
  name: string,
  normalized: string,
): Promise<EntityHit> {
  const id = crypto.randomUUID()
  await db.batch([
    db
      .prepare(
        `INSERT INTO entities (id, household_id, kind, name, status, data_json)
         VALUES (?, ?, ?, ?, 'active', '{}')`,
      )
      .bind(id, householdId, kind, name),
    db
      .prepare(
        "INSERT INTO aliases (id, household_id, entity_id, normalized) VALUES (?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), householdId, id, normalized),
  ])
  return { id, name, kind, normalized }
}

export async function updateEntity(
  db: D1Database,
  householdId: string,
  entityId: string,
  kind: string,
  name: string,
  normalized: string,
  extra: string,
): Promise<"ok" | "missing" | "exists"> {
  const current = await db
    .prepare("SELECT id FROM entities WHERE id = ? AND household_id = ? AND status = 'active'")
    .bind(entityId, householdId)
    .first<{ id: string }>()
  if (!current) return "missing"
  const alias = extra && extra !== normalized ? extra : ""
  try {
    await db.batch([
      db
        .prepare("UPDATE entities SET kind = ?, name = ? WHERE id = ? AND household_id = ? AND status = 'active'")
        .bind(kind, name, entityId, householdId),
      db.prepare("DELETE FROM aliases WHERE entity_id = ? AND household_id = ?").bind(entityId, householdId),
      db
        .prepare("INSERT INTO aliases (id, household_id, entity_id, normalized) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), householdId, entityId, normalized),
      ...(alias
        ? [
            db
              .prepare("INSERT INTO aliases (id, household_id, entity_id, normalized) VALUES (?, ?, ?, ?)")
              .bind(crypto.randomUUID(), householdId, entityId, alias),
          ]
        : []),
    ])
  } catch {
    return "exists"
  }
  return "ok"
}

export async function retireEntity(db: D1Database, householdId: string, entityId: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE entities SET status = 'retired' WHERE id = ? AND household_id = ? AND status = 'active'")
    .bind(entityId, householdId)
    .run()
  if ((result.meta.changes ?? 0) === 0) return false
  await db.prepare("DELETE FROM aliases WHERE entity_id = ? AND household_id = ?").bind(entityId, householdId).run()
  return true
}

export async function eventsForMessage(
  db: D1Database,
  householdId: string,
  messageId: string,
): Promise<StoredEvent[]> {
  const listed = await db
    .prepare(
      `SELECT e.id AS id, e.type AS type, e.occurred_at AS occurred_at,
              e.amount_minor AS amount_minor, e.currency AS currency, e.summary AS summary,
              e.warranty_ends_on AS warranty_ends_on, en.name AS entity_name
       FROM events e
       LEFT JOIN event_entities ee ON ee.event_id = e.id
       LEFT JOIN entities en ON en.id = ee.entity_id
       WHERE e.message_id = ? AND e.household_id = ? AND e.status = 'active'`,
    )
    .bind(messageId, householdId)
    .all<{
      id: string
      type: EventType
      occurred_at: string
      amount_minor: number | null
      currency: string | null
      summary: string
      warranty_ends_on: string | null
      entity_name: string | null
    }>()

  return listed.results.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    amountMinor: row.amount_minor,
    currency: row.currency,
    summary: row.summary,
    warrantyEndsOn: row.warranty_ends_on,
    entityName: row.entity_name,
  }))
}

export type EventDetail = EventAccess & {
  type: EventType
  occurredAt: string
  amountMinor: number | null
  currency: string | null
  warrantyEndsOn: string | null
  dataJson: string
  entity: EntityHit | null
}

export async function loadEventDetail(
  db: D1Database,
  householdId: string,
  eventId: string,
): Promise<EventDetail | null> {
  const row = await db
    .prepare(
      `SELECT e.id, e.actor_id, e.visibility, e.status, e.version, e.type, e.occurred_at,
              e.amount_minor, e.currency, e.warranty_ends_on, e.data_json,
              en.id AS entity_id, en.name AS entity_name, en.kind AS entity_kind
       FROM events e
       LEFT JOIN event_entities ee ON ee.event_id = e.id
       LEFT JOIN entities en ON en.id = ee.entity_id
       WHERE e.id = ? AND e.household_id = ?
       LIMIT 1`,
    )
    .bind(eventId, householdId)
    .first<{
      id: string
      actor_id: string
      visibility: string
      status: string
      version: number
      type: EventType
      occurred_at: string
      amount_minor: number | null
      currency: string | null
      warranty_ends_on: string | null
      data_json: string
      entity_id: string | null
      entity_name: string | null
      entity_kind: string | null
    }>()
  if (!row || !isVisibility(row.visibility)) return null
  return {
    id: row.id,
    actorId: row.actor_id,
    visibility: row.visibility,
    status: row.status,
    version: row.version,
    type: row.type,
    occurredAt: row.occurred_at,
    amountMinor: row.amount_minor,
    currency: row.currency,
    warrantyEndsOn: row.warranty_ends_on,
    dataJson: row.data_json,
    entity:
      row.entity_id && row.entity_name && row.entity_kind
        ? { id: row.entity_id, name: row.entity_name, kind: row.entity_kind, normalized: "" }
        : null,
  }
}

export async function requireCorrectable(
  db: D1Database,
  session: Session,
  eventId: string,
): Promise<EventAccess> {
  const event = await loadEvent(db, session.householdId, eventId)
  if (!event || event.status !== "active") {
    throw new AgentError(404, "not_found", "Não encontrei.")
  }
  if (!canVoid(session.role, event.visibility, event.actorId, session.userId)) {
    if (!canRead(session.role, event.visibility, event.actorId, session.userId)) {
      throw new AgentError(404, "not_found", "Não encontrei.")
    }
    throw new AgentError(403, "forbidden", "Não tens permissão.")
  }
  return event
}

export async function writeFact(
  db: D1Database,
  input: {
    householdId: string
    messageId: string
    actorId: string
    type: string
    occurredAt: string
    visibility: string
    version: number
    amountMinor: number | null
    currency: string | null
    warrantyEndsOn: string | null
    dataJson: string
    supersedesEventId: string | null
    summary: string
    entityId: string | null
    entityRole: string | null
    reminder: { title: string; dueAt: string; audience: "household" | "adults" } | null
  },
): Promise<string> {
  const eventId = crypto.randomUUID()
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO events (
           id, household_id, message_id, actor_id, type, occurred_at, visibility, status,
           version, amount_minor, currency, warranty_ends_on, data_json, supersedes_event_id, summary
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        eventId,
        input.householdId,
        input.messageId,
        input.actorId,
        input.type,
        input.occurredAt,
        input.visibility,
        input.version,
        input.amountMinor,
        input.currency,
        input.warrantyEndsOn,
        input.dataJson,
        input.supersedesEventId,
        input.summary,
      ),
  ]

  if (input.entityId && input.entityRole) {
    statements.push(
      db
        .prepare("INSERT INTO event_entities (event_id, entity_id, role) VALUES (?, ?, ?)")
        .bind(eventId, input.entityId, input.entityRole),
    )
  }

  if (input.reminder) {
    statements.push(
      db
        .prepare(
          `INSERT INTO reminders (id, household_id, event_id, title, due_at, audience, status)
           VALUES (?, ?, ?, ?, ?, ?, 'open')`,
        )
        .bind(
          crypto.randomUUID(),
          input.householdId,
          eventId,
          input.reminder.title,
          input.reminder.dueAt,
          input.reminder.audience,
        ),
    )
  }

  if (input.supersedesEventId) {
    statements.push(
      db
        .prepare(
          `UPDATE events SET status = 'superseded'
           WHERE id = ? AND household_id = ? AND status = 'active'`,
        )
        .bind(input.supersedesEventId, input.householdId),
    )
  }

  await db.batch(statements)
  return eventId
}

export async function indexFact(db: D1Database, eventId: string): Promise<void> {
  try {
    await indexEvent(db, eventId)
  } catch {
    // The fact stays even if the search index misses this write.
  }
}

export async function retireFact(db: D1Database, eventId: string): Promise<void> {
  await db.prepare("DELETE FROM events_fts WHERE event_id = ?").bind(eventId).run()
}

export type VoidOutcome =
  | { ok: true; id: string }
  | { ok: false; status: 403 | 404; message: string }

export async function voidFact(env: Env, session: Session, eventId: string): Promise<VoidOutcome> {
  const event = await loadEvent(env.DB, session.householdId, eventId)
  if (!event) return { ok: false, status: 404, message: "Não encontrei." }
  if (event.status === "voided") return { ok: true, id: event.id }
  if (event.status !== "active") return { ok: false, status: 404, message: "Não encontrei." }
  if (!canVoid(session.role, event.visibility, event.actorId, session.userId)) {
    if (!canRead(session.role, event.visibility, event.actorId, session.userId)) {
      return { ok: false, status: 404, message: "Não encontrei." }
    }
    return { ok: false, status: 403, message: "Não tens permissão." }
  }

  await env.DB
    .prepare(
      `UPDATE events SET status = 'voided'
       WHERE id = ? AND household_id = ? AND status = 'active'`,
    )
    .bind(event.id, session.householdId)
    .run()
  await retireFact(env.DB, event.id)
  try {
    await deleteIfOrphan(env.DB, env, event.id)
  } catch {
    // The event is already voided. File cleanup can run again later.
  }
  return { ok: true, id: event.id }
}

export async function latestEventId(
  db: D1Database,
  householdId: string,
  conversationId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT e.id AS id
       FROM events e
       JOIN messages m ON m.id = e.message_id
       WHERE e.household_id = ? AND m.conversation_id = ? AND e.status = 'active'
       ORDER BY e.occurred_at DESC
       LIMIT 1`,
    )
    .bind(householdId, conversationId)
    .first<{ id: string }>()
  return row?.id ?? null
}

export async function loadMessage(
  db: D1Database,
  householdId: string,
  messageId: string,
): Promise<{ id: string; conversationId: string; resultJson: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT id, conversation_id AS conversationId, result_json AS resultJson
       FROM messages WHERE id = ? AND household_id = ?`,
    )
    .bind(messageId, householdId)
    .first<{ id: string; conversationId: string; resultJson: string | null }>()
  return row ?? null
}

export async function openProposal(
  db: D1Database,
  householdId: string,
  conversationId: string,
): Promise<{ id: string; conversationId: string; resultJson: string } | null> {
  const listed = await db
    .prepare(
      `SELECT id, conversation_id AS conversationId, result_json AS resultJson
       FROM messages
       WHERE household_id = ? AND conversation_id = ? AND result_json IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 6`,
    )
    .bind(householdId, conversationId)
    .all<{ id: string; conversationId: string; resultJson: string }>()
  for (const row of listed.results) {
    try {
      const body = JSON.parse(row.resultJson) as { status?: string; draft?: unknown }
      if (body.status === "proposal" && body.draft) return row
    } catch {
      // A broken result is not an open proposal.
    }
  }
  return null
}

export async function saveResult(
  db: D1Database,
  householdId: string,
  messageId: string,
  columnStatus: "stored" | "interpreted",
  body: string,
): Promise<void> {
  await db
    .prepare("UPDATE messages SET status = ?, result_json = ? WHERE id = ? AND household_id = ?")
    .bind(columnStatus, body, messageId, householdId)
    .run()
}

export async function writeUsage(
  db: D1Database,
  input: {
    messageId: string
    tool: string | null
    model: string
    tokensIn: number | null
    tokensOut: number | null
    latencyMs: number
    errorCode: string | null
    createdAt: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage (
         id, trace_id, message_id, tool, model, tokens_in, tokens_out, latency_ms, error_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      crypto.randomUUID(),
      input.messageId,
      input.tool,
      input.model,
      input.tokensIn,
      input.tokensOut,
      input.latencyMs,
      input.errorCode,
      input.createdAt,
    )
    .run()
}

export function toSummary(event: StoredEvent): EventSummary {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    amountMinor: event.amountMinor,
    currency: event.currency,
    summary: event.summary,
    warrantyEndsOn: event.warrantyEndsOn,
  }
}

async function loadEvent(
  db: D1Database,
  householdId: string,
  eventId: string,
): Promise<EventAccess | null> {
  const row = await db
    .prepare(
      `SELECT id, actor_id, visibility, status, version
       FROM events WHERE id = ? AND household_id = ?`,
    )
    .bind(eventId, householdId)
    .first<{
      id: string
      actor_id: string
      visibility: string
      status: string
      version: number
    }>()
  if (!row || !isVisibility(row.visibility)) return null
  return {
    id: row.id,
    actorId: row.actor_id,
    visibility: row.visibility,
    status: row.status,
    version: row.version,
  }
}

function isVisibility(value: string): value is Visibility {
  return value === "household" || value === "adults" || value === "private"
}
