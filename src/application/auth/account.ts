import type { Role } from "../../domain/types"

export type DeviceSessionRow = {
  id: string
  deviceName: string
  userId: string
}

export async function listUsers(db: D1Database, householdId: string) {
  const result = await db
    .prepare(
      `SELECT id, display_name, role FROM users
       WHERE household_id = ? AND removed_at IS NULL
       ORDER BY display_name`,
    )
    .bind(householdId)
    .all<{ id: string; display_name: string; role: Role }>()
  return (result.results ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    role: row.role,
  }))
}

export async function renameUser(
  db: D1Database,
  userId: string,
  householdId: string,
  displayName: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE users SET display_name = ? WHERE id = ? AND household_id = ?")
    .bind(displayName, userId, householdId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function updateMember(
  db: D1Database,
  householdId: string,
  userId: string,
  displayName: string,
  role: Role | null,
  phone: string | null,
): Promise<boolean> {
  const current = await db
    .prepare("SELECT role FROM users WHERE id = ? AND household_id = ? AND removed_at IS NULL")
    .bind(userId, householdId)
    .first<{ role: string }>()
  if (!current) return false
  const nextRole = current.role === "owner" ? "owner" : role
  if (!nextRole) return false
  const result = await db
    .prepare(
      `UPDATE users SET display_name = ?, role = ?, phone = ?
       WHERE id = ? AND household_id = ? AND removed_at IS NULL`,
    )
    .bind(displayName, nextRole, phone, userId, householdId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function removeMember(db: D1Database, householdId: string, userId: string, now: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users SET removed_at = ?
       WHERE id = ? AND household_id = ? AND role != 'owner' AND removed_at IS NULL`,
    )
    .bind(now, userId, householdId)
    .run()
  if ((result.meta.changes ?? 0) === 0) return false
  await db.batch([
    db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, userId),
    db.prepare("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(now, userId),
  ])
  return true
}

export async function renameHousehold(db: D1Database, householdId: string, name: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE households SET name = ? WHERE id = ?")
    .bind(name, householdId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function listDeviceSessions(
  db: D1Database,
  householdId: string,
  userId: string,
  role: Role,
  now: string,
): Promise<DeviceSessionRow[]> {
  const owner = role === "owner" ? 1 : 0
  const result = await db
    .prepare(
      `SELECT s.id, d.name AS device_name, s.user_id
       FROM sessions s
       JOIN devices d ON d.id = s.device_id
       JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > ?
         AND u.household_id = ?
         AND (? = 1 OR s.user_id = ?)
       ORDER BY d.name`,
    )
    .bind(now, householdId, owner, userId)
    .all<{ id: string; device_name: string; user_id: string }>()
  return (result.results ?? []).map((row) => ({
    id: row.id,
    deviceName: row.device_name,
    userId: row.user_id,
  }))
}

export async function findSessionOwner(
  db: D1Database,
  sessionId: string,
): Promise<{ userId: string; householdId: string; revoked: boolean } | null> {
  const row = await db
    .prepare(
      `SELECT s.user_id, s.revoked_at, u.household_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<{ user_id: string; revoked_at: string | null; household_id: string }>()
  if (!row) return null
  return { userId: row.user_id, householdId: row.household_id, revoked: Boolean(row.revoked_at) }
}
