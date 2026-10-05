// Binding FILES, bucket agentetobias-files. Key: household/{householdId}/{fileId}.

import type { Session } from "../domain/types"
import type { Env } from "../env"

const URL_TTL_MS = 300_000

export function objectKey(householdId: string, fileId: string): string {
  return `household/${householdId}/${fileId}`
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return hex(digest)
}

export async function putObject(
  bucket: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
  mime: string,
): Promise<void> {
  const stored = await bucket.put(key, bytes, {
    httpMetadata: { contentType: mime },
  })
  if (!stored) throw new Error("r2 put failed")
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key)
}

export async function createFileUrl(
  origin: string,
  householdId: string,
  fileId: string,
  secret: string,
  now: Date,
): Promise<{ url: string; expiresAt: string }> {
  const exp = now.getTime() + URL_TTL_MS
  const sig = await hmacHex(secret, payload(householdId, fileId, exp))
  const url = new URL(`/api/files/${encodeURIComponent(fileId)}/url`, origin)
  url.searchParams.set("exp", String(exp))
  url.searchParams.set("sig", sig)
  return { url: url.toString(), expiresAt: new Date(exp).toISOString() }
}

export async function fileUrlIsValid(
  householdId: string,
  fileId: string,
  expRaw: string,
  sig: string,
  secret: string,
  now: Date,
): Promise<boolean> {
  if (!secret || !/^\d+$/.test(expRaw) || !/^[0-9a-f]{64}$/.test(sig)) return false
  const exp = Number(expRaw)
  if (!Number.isSafeInteger(exp)) return false
  const nowMs = now.getTime()
  if (exp < nowMs || exp > nowMs + URL_TTL_MS) return false
  const expected = await hmacHex(secret, payload(householdId, fileId, exp))
  return safeEqual(expected, sig)
}

/** False when the file or the event is outside this household. No row is updated then. */
export async function linkFile(
  db: D1Database,
  session: Session,
  fileId: string,
  eventId: string,
): Promise<boolean> {
  const file = await db
    .prepare("SELECT id FROM files WHERE id = ? AND household_id = ?")
    .bind(fileId, session.householdId)
    .first()
  if (!file) return false

  const event = await db
    .prepare("SELECT id FROM events WHERE id = ? AND household_id = ?")
    .bind(eventId, session.householdId)
    .first()
  if (!event) return false

  await db
    .prepare("UPDATE files SET event_id = ? WHERE id = ? AND household_id = ?")
    .bind(eventId, fileId, session.householdId)
    .run()
  return true
}

export async function deleteIfOrphan(db: D1Database, env: Env, eventId: string): Promise<void> {
  const event = await db
    .prepare("SELECT status FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ status: string }>()
  if (event?.status !== "voided") return

  const listed = await db
    .prepare("SELECT id, r2_key FROM files WHERE event_id = ?")
    .bind(eventId)
    .all<{ id: string; r2_key: string }>()

  for (const file of listed.results ?? []) {
    const other = await db
      .prepare("SELECT id FROM files WHERE r2_key = ? AND id != ? LIMIT 1")
      .bind(file.r2_key, file.id)
      .first()
    if (other) continue

    let removed = false
    try {
      await env.FILES.delete(file.r2_key)
      removed = true
    } catch {
      // Orphan left for a future cron: the voided fact matters more than the binary.
    }
    if (!removed) continue

    try {
      await db.prepare("DELETE FROM files WHERE id = ? AND event_id = ?").bind(file.id, eventId).run()
    } catch {
      // Object already removed. Leave the row for a future cron and do not fail the void.
    }
  }
}

function payload(householdId: string, fileId: string, exp: number): string {
  return `${householdId}/${fileId}/${exp}`
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return hex(sig)
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
