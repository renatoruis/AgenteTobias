import type { Role } from "../../domain/types"

export type MeBody = {
  user: { id: string; displayName: string; role: Role }
  household: { id: string; name: string; timezone: string; currency: string; locale: string }
}

export type DeviceRow = {
  id: string
  householdId: string
  kind: "personal" | "kiosk"
  name: string
}

export type UserRow = {
  id: string
  householdId: string
  displayName: string
  role: Role
  pinHash: string | null
}

export type CodeRow = {
  id: string
  householdId: string
  role: string
  expiresAt: string
  usedAt: string | null
}

export type PasskeyRow = {
  id: string
  userId: string
  credentialId: string
  publicKey: string
  signCount: number
  householdId: string
  role: Role
  displayName: string
}

type MeRow = {
  user_id: string
  display_name: string
  role: string
  household_id: string
  name: string
  timezone: string
  currency: string
  locale: string
}

function isRole(value: string): value is Role {
  return value === "owner" || value === "adult" || value === "member" || value === "child"
}

function isKind(value: string): value is DeviceRow["kind"] {
  return value === "personal" || value === "kiosk"
}

export async function hasHousehold(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM households LIMIT 1").first<{ id: string }>()
  return Boolean(row?.id)
}

export async function createBootstrap(
  db: D1Database,
  input: {
    householdId: string
    householdName: string
    userId: string
    displayName: string
    deviceId: string
    deviceName: string
    sessionId: string
    now: string
    expiresAt: string
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO households (id, name, timezone, currency, locale, created_at)
         VALUES (?, ?, 'Europe/Lisbon', 'EUR', 'pt-PT', ?)`,
      )
      .bind(input.householdId, input.householdName, input.now),
    db
      .prepare(
        `INSERT INTO users (id, household_id, display_name, role, created_at)
         VALUES (?, ?, ?, 'owner', ?)`,
      )
      .bind(input.userId, input.householdId, input.displayName, input.now),
    db
      .prepare(
        `INSERT INTO devices (id, household_id, kind, name, created_at)
         VALUES (?, ?, 'personal', ?, ?)`,
      )
      .bind(input.deviceId, input.householdId, input.deviceName, input.now),
    db
      .prepare("INSERT INTO sessions (id, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(input.sessionId, input.userId, input.deviceId, input.expiresAt),
  ])
}

export async function loadMe(db: D1Database, userId: string, householdId: string): Promise<MeBody | null> {
  const row = await db
    .prepare(
      `SELECT u.id AS user_id, u.display_name, u.role,
              h.id AS household_id, h.name, h.timezone, h.currency, h.locale
       FROM users u
       JOIN households h ON h.id = u.household_id
       WHERE u.id = ? AND u.household_id = ?`,
    )
    .bind(userId, householdId)
    .first<MeRow>()
  if (!row || !isRole(row.role)) return null
  return {
    user: { id: row.user_id, displayName: row.display_name, role: row.role },
    household: {
      id: row.household_id,
      name: row.name,
      timezone: row.timezone,
      currency: row.currency,
      locale: row.locale,
    },
  }
}

export async function credentialIds(db: D1Database, userId: string): Promise<string[]> {
  const result = await db
    .prepare("SELECT credential_id FROM passkeys WHERE user_id = ?")
    .bind(userId)
    .all<{ credential_id: string }>()
  return (result.results ?? []).map((row) => row.credential_id).filter((id) => id.length > 0)
}

export async function savePasskey(
  db: D1Database,
  input: {
    id: string
    userId: string
    credentialId: string
    publicKey: string
    signCount: number
    sessionId: string
    expiresAt: string
  },
): Promise<"ok" | "conflict"> {
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO passkeys (id, user_id, credential_id, public_key, sign_count)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(input.id, input.userId, input.credentialId, input.publicKey, input.signCount),
      db
        .prepare(
          "UPDATE sessions SET expires_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        )
        .bind(input.expiresAt, input.sessionId, input.userId),
    ])
    return "ok"
  } catch (error) {
    if (String(error).includes("UNIQUE")) return "conflict"
    throw error
  }
}

export async function findPasskey(db: D1Database, credentialId: string): Promise<PasskeyRow | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.user_id, p.credential_id, p.public_key, p.sign_count,
              u.household_id, u.role, u.display_name
       FROM passkeys p
       JOIN users u ON u.id = p.user_id
       WHERE p.credential_id = ?`,
    )
    .bind(credentialId)
    .first<{
      id: string
      user_id: string
      credential_id: string
      public_key: string
      sign_count: number
      household_id: string
      role: string
      display_name: string
    }>()
  if (!row || !isRole(row.role)) return null
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    signCount: row.sign_count,
    householdId: row.household_id,
    role: row.role,
    displayName: row.display_name,
  }
}

export async function openPersonalSession(
  db: D1Database,
  input: {
    sessionId: string
    userId: string
    deviceId: string
    expiresAt: string
    passkeyId: string
    signCount: number
    newDevice: { householdId: string; name: string; now: string } | null
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = []
  if (input.newDevice) {
    statements.push(
      db
        .prepare(
          `INSERT INTO devices (id, household_id, kind, name, created_at)
           VALUES (?, ?, 'personal', ?, ?)`,
        )
        .bind(input.deviceId, input.newDevice.householdId, input.newDevice.name, input.newDevice.now),
    )
  }
  statements.push(
    db
      .prepare("INSERT INTO sessions (id, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(input.sessionId, input.userId, input.deviceId, input.expiresAt),
    db.prepare("UPDATE passkeys SET sign_count = ? WHERE id = ?").bind(input.signCount, input.passkeyId),
  )
  await db.batch(statements)
}

export async function revokeSession(db: D1Database, sessionId: string, revokedAt: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(revokedAt, sessionId)
    .run()
}

export async function findDevice(db: D1Database, deviceId: string): Promise<DeviceRow | null> {
  const row = await db
    .prepare("SELECT id, household_id, kind, name FROM devices WHERE id = ?")
    .bind(deviceId)
    .first<{ id: string; household_id: string; kind: string; name: string }>()
  if (!row || !isKind(row.kind)) return null
  return { id: row.id, householdId: row.household_id, kind: row.kind, name: row.name }
}

export async function findUser(db: D1Database, userId: string): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT id, household_id, display_name, role, pin_hash FROM users WHERE id = ?")
    .bind(userId)
    .first<{
      id: string
      household_id: string
      display_name: string
      role: string
      pin_hash: string | null
    }>()
  if (!row || !isRole(row.role)) return null
  return {
    id: row.id,
    householdId: row.household_id,
    displayName: row.display_name,
    role: row.role,
    pinHash: row.pin_hash,
  }
}

// invites.id é o id do user. Não há coluna user_id. O código do tablet fica em devices.
export async function createInvite(
  db: D1Database,
  input: {
    userId: string
    householdId: string
    displayName: string
    role: Exclude<Role, "owner">
    codeHash: string
    now: string
    expiresAt: string
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, household_id, display_name, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.userId, input.householdId, input.displayName, input.role, input.now),
    db
      .prepare(
        `INSERT INTO invites (id, household_id, role, code_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.userId, input.householdId, input.role, input.codeHash, input.expiresAt),
  ])
}

export async function findCode(db: D1Database, codeHash: string): Promise<CodeRow | null> {
  const row = await db
    .prepare("SELECT id, household_id, role, expires_at, used_at FROM invites WHERE code_hash = ?")
    .bind(codeHash)
    .first<{
      id: string
      household_id: string
      role: string
      expires_at: string
      used_at: string | null
    }>()
  if (!row) return null
  return {
    id: row.id,
    householdId: row.household_id,
    role: row.role,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  }
}

export async function redeemInvite(
  db: D1Database,
  input: {
    userId: string
    householdId: string
    displayName: string
    deviceId: string
    deviceName: string
    sessionId: string
    now: string
    expiresAt: string
  },
): Promise<boolean> {
  const used = await db
    .prepare("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(input.now, input.userId)
    .run()
  if ((used.meta.changes ?? 0) === 0) return false
  try {
    await db.batch([
      db
        .prepare("UPDATE users SET display_name = ? WHERE id = ? AND household_id = ?")
        .bind(input.displayName, input.userId, input.householdId),
      db
        .prepare(
          `INSERT INTO devices (id, household_id, kind, name, created_at)
           VALUES (?, ?, 'personal', ?, ?)`,
        )
        .bind(input.deviceId, input.householdId, input.deviceName, input.now),
      db
        .prepare("INSERT INTO sessions (id, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)")
        .bind(input.sessionId, input.userId, input.deviceId, input.expiresAt),
    ])
  } catch (error) {
    await db
      .prepare("UPDATE invites SET used_at = NULL WHERE id = ? AND used_at = ?")
      .bind(input.userId, input.now)
      .run()
    throw error
  }
  return true
}

export async function createKiosk(
  db: D1Database,
  input: {
    deviceId: string
    householdId: string
    name: string
    codeHash: string
    now: string
    expiresAt: string
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO devices (id, household_id, kind, name, created_at, code_hash, code_expires_at)
       VALUES (?, ?, 'kiosk', ?, ?, ?, ?)`,
    )
    .bind(input.deviceId, input.householdId, input.name, input.now, input.codeHash, input.expiresAt)
    .run()
}

export async function findKioskByCode(
  db: D1Database,
  codeHash: string,
): Promise<{ id: string; householdId: string; expiresAt: string; usedAt: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT id, household_id, code_expires_at, code_used_at
       FROM devices WHERE kind = 'kiosk' AND code_hash = ?`,
    )
    .bind(codeHash)
    .first<{
      id: string
      household_id: string
      code_expires_at: string | null
      code_used_at: string | null
    }>()
  if (!row?.code_expires_at) return null
  return {
    id: row.id,
    householdId: row.household_id,
    expiresAt: row.code_expires_at,
    usedAt: row.code_used_at,
  }
}

export async function consumeKioskCode(db: D1Database, deviceId: string, usedAt: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE devices SET code_used_at = ? WHERE id = ? AND kind = 'kiosk' AND code_used_at IS NULL")
    .bind(usedAt, deviceId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function openKioskSession(
  db: D1Database,
  input: { sessionId: string; userId: string; deviceId: string; expiresAt: string },
): Promise<void> {
  await db
    .prepare("INSERT INTO sessions (id, user_id, device_id, expires_at) VALUES (?, ?, ?, ?)")
    .bind(input.sessionId, input.userId, input.deviceId, input.expiresAt)
    .run()
}

export async function setPin(
  db: D1Database,
  userId: string,
  householdId: string,
  pinHash: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE users SET pin_hash = ? WHERE id = ? AND household_id = ?")
    .bind(pinHash, userId, householdId)
    .run()
  return (result.meta.changes ?? 0) > 0
}
