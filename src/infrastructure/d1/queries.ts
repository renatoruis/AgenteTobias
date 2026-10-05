import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  sql,
  sum,
  type SQL,
} from "drizzle-orm"
import { type Database } from "./client"
import { eventEntities, events, messages, reminders } from "./schema"

export type InsertMessageResult = {
  message: typeof messages.$inferSelect
  idempotent: boolean
}

export async function insertMessage(
  db: Database,
  input: typeof messages.$inferInsert,
): Promise<InsertMessageResult> {
  const inserted = await db
    .insert(messages)
    .values(input)
    .onConflictDoNothing({
      target: [messages.householdId, messages.clientMessageId],
    })
    .returning()

  const created = inserted[0]
  if (created) return { message: created, idempotent: false }

  const existing = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.householdId, input.householdId),
        eq(messages.clientMessageId, input.clientMessageId),
      ),
    )
    .limit(1)

  const message = existing[0]
  if (!message) {
    throw new Error(
      "insertMessage did not find a row for this household and clientMessageId",
    )
  }
  return { message, idempotent: true }
}

/** Sum of `amount_minor` on `active` events. `to` is exclusive. Visibility is the caller's clause. */
export async function sumAmount(
  db: Database,
  householdId: string,
  type: string,
  entityId: string | null,
  from: string,
  to: string,
  visibilityClause: SQL,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(${sum(events.amountMinor)}, 0)`,
    })
    .from(events)
    .where(
      and(
        eq(events.householdId, householdId),
        eq(events.type, type),
        eq(events.status, "active"),
        gte(events.occurredAt, from),
        lt(events.occurredAt, to),
        entityId === null
          ? undefined
          : exists(
              db
                .select({ one: sql`1` })
                .from(eventEntities)
                .where(
                  and(
                    eq(eventEntities.eventId, events.id),
                    eq(eventEntities.entityId, entityId),
                  ),
                ),
            ),
        visibilityClause,
      ),
    )

  const total = Number(row?.total ?? 0)
  return Number.isFinite(total) ? total : 0
}

export async function listReminders(
  db: Database,
  householdId: string,
  audienceAllowed: readonly ("household" | "adults")[],
  status: "open" | "done",
) {
  if (audienceAllowed.length === 0) return []

  return db
    .select({
      id: reminders.id,
      title: reminders.title,
      dueAt: reminders.dueAt,
      audience: reminders.audience,
      eventId: reminders.eventId,
    })
    .from(reminders)
    .where(
      and(
        eq(reminders.householdId, householdId),
        eq(reminders.status, status),
        inArray(reminders.audience, [...audienceAllowed]),
      ),
    )
    .orderBy(asc(reminders.dueAt))
}
