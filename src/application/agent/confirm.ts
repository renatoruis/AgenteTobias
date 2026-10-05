import type { EventSummary, EventType, MessageResponse, Session, Visibility } from "../../domain/types"
import { AgentError } from "./errors"
import {
  createEntity,
  eventsForMessage,
  findAlias,
  indexFact,
  insertReminder,
  loadMessage,
  retireFact,
  saveResult,
  toSummary,
  writeFact,
} from "./sql"

export type ProposalDraft =
  | {
      kind: "event"
      savedReply: string
      type: EventType
      occurredAt: string
      visibility: Visibility
      version: number
      amountMinor: number | null
      currency: string | null
      warrantyEndsOn: string | null
      dataJson: string
      supersedesEventId: string | null
      summary: string
      entity:
        | { mode: "link"; id: string; role: string }
        | { mode: "create"; kind: string; name: string; normalized: string; role: string }
        | null
      reminder: { title: string; dueAt: string; audience: "household" | "adults" } | null
    }
  | {
      kind: "reminder"
      savedReply: string
      title: string
      dueAt: string
      audience: "household" | "adults"
      eventId: string | null
    }
  | {
      kind: "entity"
      savedReply: string
      entityKind: string
      name: string
      normalized: string
    }

type StoredBody = MessageResponse & { draft?: ProposalDraft }

export async function confirmMessage(
  env: { DB: D1Database },
  session: Session,
  messageId: string,
  accept: boolean,
): Promise<MessageResponse> {
  const row = await loadMessage(env.DB, session.householdId, messageId)
  if (!row) throw new AgentError(404, "not_found", "Não encontrei.")
  const stored = parseStored(row.resultJson)
  if (!stored) throw new AgentError(404, "not_found", "Não encontrei.")

  if (stored.status !== "proposal" || !stored.draft) {
    return { ...publicResponse(stored, row.id, row.conversationId), idempotent: true }
  }

  if (!accept) {
    const response = decided(row.id, row.conversationId, "Não gravei.", [])
    await saveResult(env.DB, session.householdId, row.id, "interpreted", JSON.stringify(response))
    return response
  }

  const already = await eventsForMessage(env.DB, session.householdId, row.id)
  if (already.length > 0) {
    const response = decided(row.id, row.conversationId, stored.draft.savedReply, already.map(toSummary))
    await saveResult(env.DB, session.householdId, row.id, "interpreted", JSON.stringify(response))
    return { ...response, idempotent: true }
  }

  const events = await writeDraft(env.DB, session, row.id, stored.draft)
  const response = decided(row.id, row.conversationId, stored.draft.savedReply, events)
  await saveResult(env.DB, session.householdId, row.id, "interpreted", JSON.stringify(response))
  return response
}

async function writeDraft(
  db: D1Database,
  session: Session,
  messageId: string,
  draft: ProposalDraft,
): Promise<EventSummary[]> {
  if (draft.kind === "reminder") {
    await insertReminder(db, {
      householdId: session.householdId,
      eventId: draft.eventId,
      title: draft.title,
      dueAt: draft.dueAt,
      audience: draft.audience,
    })
    return []
  }

  if (draft.kind === "entity") {
    const existing = await findAlias(db, session.householdId, draft.normalized)
    if (!existing) {
      try {
        await createEntity(db, session.householdId, draft.entityKind, draft.name, draft.normalized)
      } catch {
        await findAlias(db, session.householdId, draft.normalized)
      }
    }
    return []
  }

  let entityId: string | null = null
  let entityRole: string | null = null
  if (draft.entity?.mode === "link") {
    entityId = draft.entity.id
    entityRole = draft.entity.role
  } else if (draft.entity?.mode === "create") {
    const existing = await findAlias(db, session.householdId, draft.entity.normalized)
    const created =
      existing ??
      (await createEntity(db, session.householdId, draft.entity.kind, draft.entity.name, draft.entity.normalized).catch(
        async () => findAlias(db, session.householdId, draft.entity && draft.entity.mode === "create" ? draft.entity.normalized : ""),
      ))
    if (created) {
      entityId = created.id
      entityRole = created.kind
    }
  }

  const eventId = await writeFact(db, {
    householdId: session.householdId,
    messageId,
    actorId: session.userId,
    type: draft.type,
    occurredAt: draft.occurredAt,
    visibility: draft.visibility,
    version: draft.version,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    warrantyEndsOn: draft.warrantyEndsOn,
    dataJson: draft.dataJson,
    supersedesEventId: draft.supersedesEventId,
    summary: draft.summary,
    entityId,
    entityRole,
    reminder: draft.reminder,
  })
  await indexFact(db, eventId)
  if (draft.supersedesEventId) await retireFact(db, draft.supersedesEventId)
  return [
    {
      id: eventId,
      type: draft.type,
      occurredAt: draft.occurredAt,
      amountMinor: draft.amountMinor,
      currency: draft.currency,
      summary: draft.summary,
      warrantyEndsOn: draft.warrantyEndsOn,
    },
  ]
}

function decided(messageId: string, conversationId: string, reply: string, events: EventSummary[]): MessageResponse {
  return {
    messageId,
    conversationId,
    status: "interpreted",
    reply,
    events,
    clarification: null,
    idempotent: false,
  }
}

function parseStored(json: string | null): StoredBody | null {
  if (!json) return null
  try {
    const body = JSON.parse(json) as StoredBody
    if (typeof body.reply !== "string" || typeof body.status !== "string") return null
    return body
  } catch {
    return null
  }
}

function publicResponse(stored: StoredBody, messageId: string, conversationId: string): MessageResponse {
  return {
    messageId,
    conversationId,
    status:
      stored.status === "clarification" || stored.status === "stored" || stored.status === "proposal"
        ? stored.status
        : "interpreted",
    reply: stored.reply,
    events: Array.isArray(stored.events) ? stored.events : [],
    clarification: stored.clarification ?? null,
    idempotent: true,
  }
}
