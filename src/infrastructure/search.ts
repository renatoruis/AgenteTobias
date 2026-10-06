import { canRead } from "../domain/access"
import type { EventSummary, Session, Visibility } from "../domain/types"

const MAX_TEXT_RESULTS = 8

type EventRow = {
  id: string
  type: EventSummary["type"]
  occurred_at: string
  amount_minor: number | null
  currency: string | null
  summary: string
  warranty_ends_on: string | null
  visibility: string
  actor_id: string
  status: string
}

export async function indexEvent(db: D1Database, eventId: string): Promise<void> {
  const row = await db
    .prepare(
      `SELECT e.summary AS summary, e.household_id AS household_id, m.text AS text
       FROM events e
       JOIN messages m ON m.id = e.message_id
       WHERE e.id = ?`,
    )
    .bind(eventId)
    .first<{ summary: string; household_id: string; text: string }>()

  if (!row) return

  const body = `${row.summary} ${row.text}`
  await db.batch([
    db.prepare(`DELETE FROM events_fts WHERE event_id = ?`).bind(eventId),
    db
      .prepare(`INSERT INTO events_fts (event_id, household_id, body) VALUES (?, ?, ?)`)
      .bind(eventId, row.household_id, body),
  ])
}

export async function searchText(db: D1Database, session: Session, query: string): Promise<EventSummary[]> {
  const text = query.trim()
  if (!text) return []

  const ids = await ftsEventIds(db, session.householdId, text)
  if (ids.length === 0) return []

  const rows = await hydrate(db, session.householdId, ids)
  return rows
    .filter((row) => row.status === "active" && readable(session, row))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id))
    .slice(0, MAX_TEXT_RESULTS)
    .map(toSummary)
}

async function ftsEventIds(db: D1Database, householdId: string, query: string): Promise<string[]> {
  try {
    const listed = await db
      .prepare(
        `SELECT event_id AS id
         FROM events_fts
         WHERE events_fts MATCH ? AND household_id = ?`,
      )
      .bind(query, householdId)
      .all<{ id: string }>()
    return listed.results.map((row) => row.id)
  } catch {
    return []
  }
}

async function hydrate(db: D1Database, householdId: string, ids: string[]): Promise<EventRow[]> {
  const marks = ids.map(() => "?").join(", ")
  const listed = await db
    .prepare(
      `SELECT id, type, occurred_at, amount_minor, currency, summary, warranty_ends_on,
              visibility, actor_id, status
       FROM events
       WHERE household_id = ? AND status = 'active' AND id IN (${marks})`,
    )
    .bind(householdId, ...ids)
    .all<EventRow>()
  return listed.results
}

function toSummary(row: EventRow): EventSummary {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    amountMinor: row.amount_minor,
    currency: row.currency,
    summary: row.summary,
    warrantyEndsOn: row.warranty_ends_on,
  }
}

function readable(session: Session, row: { visibility: string; actor_id: string }): boolean {
  return canRead(session.role, row.visibility as Visibility, row.actor_id, session.userId)
}
