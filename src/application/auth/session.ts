import type { Role, Session } from "../../domain/types"
import { base64UrlToBytes, bytesToBase64Url } from "./codec"

export const SESSION_COOKIE = "tobias_session"
export const DEVICE_COOKIE = "tobias_device"
export const CHALLENGE_COOKIE = "tobias_challenge"

export const PERSONAL_SECONDS = 2_592_000
export const BOOTSTRAP_SECONDS = 1_800
export const KIOSK_SECONDS = 900
export const CHALLENGE_SECONDS = 300
export const DEVICE_SECONDS = 60 * 60 * 24 * 365

export type ChallengePurpose = "register" | "login"

export type ChallengePayload = {
  challenge: string
  purpose: ChallengePurpose
  userId?: string
}

type SessionRow = {
  user_id: string
  device_id: string
  expires_at: string
  revoked_at: string | null
  household_id: string
  role: string
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    const key = part.slice(0, separator).trim()
    if (key !== name) continue
    const raw = part.slice(separator + 1).trim()
    if (!raw) return null
    const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
    try {
      return decodeURIComponent(unquoted)
    } catch {
      return unquoted
    }
  }
  return null
}

export function encodeChallenge(payload: ChallengePayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

export function decodeChallenge(value: string | null): ChallengePayload | null {
  if (!value || value.length > 2048) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const record = parsed as Record<string, unknown>
    if (typeof record.challenge !== "string" || record.challenge.length < 8) return null
    if (record.purpose !== "register" && record.purpose !== "login") return null
    if (record.userId !== undefined && typeof record.userId !== "string") return null
    return {
      challenge: record.challenge,
      purpose: record.purpose,
      userId: typeof record.userId === "string" ? record.userId : undefined,
    }
  } catch {
    return null
  }
}

export function expiresAt(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString()
}

function isRole(value: string): value is Role {
  return value === "owner" || value === "adult" || value === "member" || value === "child"
}

export async function readSession(
  db: D1Database,
  cookieHeader: string | null,
  now: Date,
): Promise<Session | null> {
  const sessionId = readCookie(cookieHeader, SESSION_COOKIE)
  if (!sessionId) return null
  const row = await db
    .prepare(
      `SELECT s.user_id, s.device_id, s.expires_at, s.revoked_at, u.household_id, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<SessionRow>()
  if (!row?.user_id || !row.device_id || !row.household_id) return null
  if (row.revoked_at) return null
  if (!isRole(row.role)) return null
  const expiry = Date.parse(row.expires_at)
  if (Number.isNaN(expiry) || expiry <= now.getTime()) return null
  return {
    userId: row.user_id,
    householdId: row.household_id,
    role: row.role,
    deviceId: row.device_id,
  }
}
