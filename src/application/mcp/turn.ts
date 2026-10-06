import type { Session } from "../../domain/types"
import { householdCard as loadCard } from "../agent/sql"
import type { HouseholdCard } from "../agent/context"

export type TurnMessage = { id: string; text: string; conversationId: string }

export async function loadHouseholdCard(db: D1Database, session: Session): Promise<HouseholdCard> {
  return loadCard(db, session)
}

/** One conversation per person. The message exists so a saved fact can point at it. */
export async function toolMessage(
  db: D1Database,
  session: Session,
  text: string,
  now: Date,
): Promise<TurnMessage> {
  const existing = await db
    .prepare(
      `SELECT id FROM conversations
       WHERE household_id = ? AND user_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(session.householdId, session.userId)
    .first<{ id: string }>()
  let conversationId = existing?.id
  if (!conversationId) {
    conversationId = crypto.randomUUID()
    await db
      .prepare("INSERT INTO conversations (id, household_id, user_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(conversationId, session.householdId, session.userId, now.toISOString())
      .run()
  }
  const id = crypto.randomUUID()
  const clipped = text.trim().slice(0, 500) || "mcp"
  await db
    .prepare(
      `INSERT INTO messages (
         id, household_id, actor_id, conversation_id, client_message_id, text, source, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'text', 'stored', ?)`,
    )
    .bind(id, session.householdId, session.userId, conversationId, id, clipped, now.toISOString())
    .run()
  return { id, text: clipped, conversationId }
}
