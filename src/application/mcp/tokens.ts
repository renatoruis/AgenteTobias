import { hashCode } from "../auth/codes"
import type { Role, Session } from "../../domain/types"

export type McpTokenRow = {
  id: string
  created_at: string
}

export async function sessionFromToken(
  db: D1Database,
  token: string,
  pepper: string,
): Promise<Session | null> {
  if (!token || token.length > 200) return null
  const hash = await hashCode("mcp", token, pepper)
  const row = await db
    .prepare(
      `SELECT t.user_id, t.household_id, u.role,
              (SELECT d.id FROM devices d WHERE d.household_id = t.household_id ORDER BY d.created_at LIMIT 1) AS device_id
       FROM mcp_tokens t
       JOIN users u ON u.id = t.user_id AND u.household_id = t.household_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
    )
    .bind(hash)
    .first<{ user_id: string; household_id: string; role: string; device_id: string | null }>()
  if (!row || !isRole(row.role)) return null
  return {
    userId: row.user_id,
    householdId: row.household_id,
    role: row.role,
    deviceId: row.device_id ?? row.user_id,
  }
}

export async function activeToken(db: D1Database, householdId: string): Promise<McpTokenRow | null> {
  return db
    .prepare(
      `SELECT id, created_at FROM mcp_tokens
       WHERE household_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(householdId)
    .first<McpTokenRow>()
}

/** Revokes any active token and stores the hash. Returns the plaintext once. */
export async function issueToken(
  db: D1Database,
  session: Session,
  pepper: string,
  now: Date,
): Promise<string> {
  const token = hex(32)
  const nowIso = now.toISOString()
  await db.batch([
    db
      .prepare(
        `UPDATE mcp_tokens SET revoked_at = ?
         WHERE household_id = ? AND revoked_at IS NULL`,
      )
      .bind(nowIso, session.householdId),
    db
      .prepare(
        `INSERT INTO mcp_tokens (id, household_id, user_id, token_hash, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), session.householdId, session.userId, await hashCode("mcp", token, pepper), nowIso),
  ])
  return token
}

export async function revokeToken(db: D1Database, householdId: string, tokenId: string, now: Date): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE mcp_tokens SET revoked_at = ?
       WHERE id = ? AND household_id = ? AND revoked_at IS NULL`,
    )
    .bind(now.toISOString(), tokenId, householdId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

function hex(size: number): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function isRole(value: string): value is Role {
  return value === "owner" || value === "adult" || value === "member" || value === "child"
}
