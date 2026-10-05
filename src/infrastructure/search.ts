import { canRead } from "../domain/access"
import type { EventSummary, Session, Visibility } from "../domain/types"
import type { Env } from "../env"

const EMBEDDING_DIMENSION = 1024
const MAX_EMBED_JOBS = 20
const MAX_TEXT_RESULTS = 8
const LISBON = "Europe/Lisbon"

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

type PendingJob = {
  event_id: string
  vector_id: string | null
  text_hash: string | null
  summary: string
  type: string
  occurred_at: string
  visibility: string
  status: string
  household_id: string
}

export function canonicalText(event: {
  summary: string
  type: string
  occurredAt: string
}): string {
  return `${event.type} ${event.summary} ${civilDate(event.occurredAt)}`
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

export async function searchText(
  db: D1Database,
  session: Session,
  query: string,
  env?: Env,
): Promise<EventSummary[]> {
  const text = query.trim()
  if (!text) return []

  const ids = new Set<string>(await ftsEventIds(db, session.householdId, text))
  if (env?.EMBEDDINGS === "1") {
    for (const id of await vectorEventIds(env, session, text)) ids.add(id)
  }
  if (ids.size === 0) return []

  const rows = await hydrate(db, session.householdId, [...ids])
  return rows
    .filter((row) => row.status === "active" && readable(session, row))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id))
    .slice(0, MAX_TEXT_RESULTS)
    .map(toSummary)
}

export async function embedPending(env: Env, limit: number): Promise<number> {
  if (env.EMBEDDINGS !== "1") return 0

  const capped = jobLimit(limit)
  if (capped === 0) return 0

  const listed = await env.DB.prepare(
    `SELECT j.event_id AS event_id, j.vector_id AS vector_id, j.text_hash AS text_hash,
            e.summary AS summary, e.type AS type, e.occurred_at AS occurred_at,
            e.visibility AS visibility, e.status AS status, e.household_id AS household_id
     FROM embedding_jobs j
     JOIN events e ON e.id = j.event_id
     WHERE j.status = 'pending'
     ORDER BY j.rowid
     LIMIT ?`,
  )
    .bind(capped)
    .all<PendingJob>()

  let settled = 0
  for (const job of listed.results) {
    try {
      if (await settleJob(env, job)) settled += 1
    } catch {
      // Vectorize or the model failed. The job stays pending. The event stays stored.
    }
  }
  return settled
}

async function settleJob(env: Env, job: PendingJob): Promise<boolean> {
  if (job.status === "voided" || job.status === "superseded") {
    if (job.vector_id) await env.VECTORS.deleteByIds([job.vector_id])
    await env.DB.prepare(
      `UPDATE embedding_jobs SET status = 'ready', vector_id = NULL WHERE event_id = ?`,
    )
      .bind(job.event_id)
      .run()
    return true
  }

  if (job.status !== "active") return false

  const text = canonicalText({
    summary: job.summary,
    type: job.type,
    occurredAt: job.occurred_at,
  })
  const hash = await sha256(text)
  if (job.text_hash === hash && job.vector_id) {
    await env.DB.prepare(
      `UPDATE embedding_jobs SET status = 'ready', vector_id = ?, text_hash = ? WHERE event_id = ?`,
    )
      .bind(job.vector_id, hash, job.event_id)
      .run()
    return true
  }

  const vector = readVector(await runEmbedding(env, text))
  if (!vector) return false
  if (vector.length !== EMBEDDING_DIMENSION) {
    await env.DB.prepare(`UPDATE embedding_jobs SET status = 'failed' WHERE event_id = ?`)
      .bind(job.event_id)
      .run()
    return true
  }

  await env.VECTORS.upsert([
    {
      id: job.event_id,
      values: vector,
      metadata: {
        householdId: job.household_id,
        visibility: job.visibility,
        eventId: job.event_id,
      },
    },
  ])

  await env.DB.prepare(
    `UPDATE embedding_jobs SET status = 'ready', vector_id = ?, text_hash = ? WHERE event_id = ?`,
  )
    .bind(job.event_id, hash, job.event_id)
    .run()
  return true
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

async function vectorEventIds(env: Env, session: Session, query: string): Promise<string[]> {
  let vector: number[] | null
  try {
    vector = readVector(await runEmbedding(env, query))
  } catch {
    return []
  }
  if (!vector || vector.length !== EMBEDDING_DIMENSION) return []

  try {
    const found = await env.VECTORS.query(vector, {
      topK: MAX_TEXT_RESULTS,
      filter: { householdId: session.householdId },
      returnMetadata: "indexed",
    })
    const ids: string[] = []
    for (const match of found.matches) {
      const householdId = match.metadata?.householdId
      if (typeof householdId === "string" && householdId !== session.householdId) continue
      ids.push(match.id)
    }
    return ids
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

async function runEmbedding(env: Env, text: string): Promise<unknown> {
  return env.AI.run(env.AI_EMBED_MODEL, { text }, { gateway: { id: env.AI_GATEWAY_ID } })
}

function readVector(result: unknown): number[] | null {
  if (!result || typeof result !== "object") return null
  const data = (result as { data?: unknown }).data
  if (!Array.isArray(data) || data.length === 0) return null
  const first = data[0]
  if (typeof first === "number") {
    return data.every((value) => typeof value === "number") ? (data as number[]) : null
  }
  if (Array.isArray(first) && first.every((value) => typeof value === "number")) return first
  return null
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

function civilDate(occurredAt: string): string {
  const date = new Date(occurredAt)
  if (Number.isNaN(date.getTime())) return occurredAt.slice(0, 10)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LISBON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}`
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function jobLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0
  return Math.min(MAX_EMBED_JOBS, Math.max(0, Math.trunc(limit)))
}
