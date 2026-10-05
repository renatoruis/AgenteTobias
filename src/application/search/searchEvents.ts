import { canRead } from "../../domain/access"
import type { EventSummary, EventType, Session, Visibility } from "../../domain/types"

export type EventFilter = {
  type?: EventType
  entityId?: string
  /** Inclusive lower bound on occurred_at, ISO-8601. */
  from?: string
  /** Exclusive upper bound on occurred_at, ISO-8601. */
  to?: string
}

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
}

export async function searchEvents(
  db: D1Database,
  session: Session,
  filter: EventFilter,
): Promise<EventSummary[]> {
  const type = filter.type ?? null
  const from = filter.from || null
  const to = filter.to || null
  const entityId = filter.entityId || null

  const listed = await db
    .prepare(
      `SELECT e.id, e.type, e.occurred_at, e.amount_minor, e.currency, e.summary,
              e.warranty_ends_on, e.visibility, e.actor_id
       FROM events e
       WHERE e.household_id = ?
         AND e.status = 'active'
         AND (? IS NULL OR e.type = ?)
         AND (? IS NULL OR e.occurred_at >= ?)
         AND (? IS NULL OR e.occurred_at < ?)
         AND (
           ? IS NULL OR EXISTS (
             SELECT 1 FROM event_entities ee
             WHERE ee.event_id = e.id AND ee.entity_id = ?
           )
         )
       ORDER BY e.occurred_at DESC, e.id DESC`,
    )
    .bind(session.householdId, type, type, from, from, to, to, entityId, entityId)
    .all<EventRow>()

  return listed.results
    .filter((row) => canRead(session.role, row.visibility as Visibility, row.actor_id, session.userId))
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
