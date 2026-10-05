import type { Role } from "../../domain/types"
import {
  defaultPreferences,
  parsePreferences,
  preferencesFromRow,
  type PreferenceRow,
  type Preferences,
} from "../notifications/preferences"

const TOKEN = /^[0-9a-f]{64}$/i

export type DeviceSessionRow = {
  id: string
  deviceName: string
  userId: string
}

export async function listUsers(db: D1Database, householdId: string) {
  const result = await db
    .prepare(
      `SELECT id, display_name, role FROM users
       WHERE household_id = ? ORDER BY display_name`,
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

export async function renameHousehold(db: D1Database, householdId: string, name: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE households SET name = ? WHERE id = ?")
    .bind(name, householdId)
    .run()
  return (result.meta.changes ?? 0) > 0
}

export async function loadPreferences(db: D1Database, userId: string): Promise<Preferences> {
  const row = await db
    .prepare(
      `SELECT theme, accent, speak_replies, speech_rate, notify_reminders, notify_sound, notify_badge,
              quiet_start, quiet_end
       FROM user_preferences WHERE user_id = ?`,
    )
    .bind(userId)
    .first<PreferenceRow>()
  if (!row) return defaultPreferences()
  return preferencesFromRow(row)
}

export async function savePreferences(db: D1Database, userId: string, preferences: Preferences): Promise<void> {
  const quiet = preferences.notifications.quietHours
  await db
    .prepare(
      `INSERT INTO user_preferences (
         user_id, theme, accent, speak_replies, speech_rate,
         notify_reminders, notify_sound, notify_badge, quiet_start, quiet_end
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         theme = excluded.theme,
         accent = excluded.accent,
         speak_replies = excluded.speak_replies,
         speech_rate = excluded.speech_rate,
         notify_reminders = excluded.notify_reminders,
         notify_sound = excluded.notify_sound,
         notify_badge = excluded.notify_badge,
         quiet_start = excluded.quiet_start,
         quiet_end = excluded.quiet_end`,
    )
    .bind(
      userId,
      preferences.appearance.theme,
      preferences.appearance.accent,
      preferences.voice.speakReplies ? 1 : 0,
      preferences.voice.rate,
      preferences.notifications.reminders ? 1 : 0,
      preferences.notifications.sound ? 1 : 0,
      preferences.notifications.badge ? 1 : 0,
      quiet?.start ?? null,
      quiet?.end ?? null,
    )
    .run()
}

export function readPreferencesBody(body: unknown): Preferences | null {
  return parsePreferences(body)
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

export async function savePushToken(
  db: D1Database,
  input: { id: string; deviceId: string; userId: string; token: string; environment: string; updatedAt: string },
): Promise<boolean> {
  if (!TOKEN.test(input.token)) return false
  if (input.environment !== "sandbox" && input.environment !== "production") return false
  await db
    .prepare(
      `INSERT INTO push_tokens (id, device_id, user_id, token, environment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id, user_id) DO UPDATE SET
         token = excluded.token,
         environment = excluded.environment,
         updated_at = excluded.updated_at`,
    )
    .bind(input.id, input.deviceId, input.userId, input.token.toLowerCase(), input.environment, input.updatedAt)
    .run()
  return true
}
