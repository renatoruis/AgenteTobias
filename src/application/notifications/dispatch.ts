import { canRead } from "../../domain/access"
import type { Role, Visibility } from "../../domain/types"
import type { Env } from "../../env"
import { sendAlert } from "../../infrastructure/apns"
import { isQuiet } from "./quiet"

type DueRow = {
  reminder_id: string
  title: string
  audience: string
  household_id: string
  user_id: string
  role: string
  notify_reminders: number | null
  notify_sound: number | null
  notify_badge: number | null
  quiet_start: string | null
  quiet_end: string | null
  token: string
  environment: string
  token_id: string
}

type Token = { id: string; token: string; environment: "sandbox" | "production" }

type Bucket = {
  reminderId: string
  title: string
  audience: string
  householdId: string
  userId: string
  role: string
  remindersOn: boolean
  sound: boolean
  badge: boolean
  quietStart: string | null
  quietEnd: string | null
  tokens: Token[]
}

function isRole(value: string): value is Role {
  return value === "owner" || value === "adult" || value === "member" || value === "child"
}

function audienceVisibility(audience: string): Visibility | null {
  if (audience === "household" || audience === "adults") return audience
  return null
}

export async function dispatchDueReminders(env: Env, now: Date): Promise<void> {
  const due = now.toISOString()
  const result = await env.DB.prepare(
    `SELECT r.id AS reminder_id, r.title, r.audience, r.household_id,
            u.id AS user_id, u.role,
            p.notify_reminders, p.notify_sound, p.notify_badge, p.quiet_start, p.quiet_end,
            t.token, t.environment, t.id AS token_id
     FROM reminders r
     JOIN users u ON u.household_id = r.household_id
     LEFT JOIN user_preferences p ON p.user_id = u.id
     JOIN push_tokens t ON t.user_id = u.id AND t.device_id IN (
       SELECT id FROM devices WHERE household_id = r.household_id
     )
     LEFT JOIN reminder_deliveries d ON d.reminder_id = r.id AND d.user_id = u.id
     WHERE r.status = 'open' AND r.due_at <= ? AND d.reminder_id IS NULL
     ORDER BY r.due_at
     LIMIT 100`,
  )
    .bind(due)
    .all<DueRow>()

  const buckets = new Map<string, Bucket>()
  for (const row of result.results ?? []) {
    if (row.environment !== "sandbox" && row.environment !== "production") continue
    const key = `${row.reminder_id}:${row.user_id}`
    const token: Token = { id: row.token_id, token: row.token, environment: row.environment }
    const existing = buckets.get(key)
    if (existing) {
      existing.tokens.push(token)
      continue
    }
    buckets.set(key, {
      reminderId: row.reminder_id,
      title: row.title,
      audience: row.audience,
      householdId: row.household_id,
      userId: row.user_id,
      role: row.role,
      remindersOn: row.notify_reminders !== 0,
      sound: row.notify_sound !== 0,
      badge: row.notify_badge !== 0,
      quietStart: row.quiet_start,
      quietEnd: row.quiet_end,
      tokens: [token],
    })
  }

  let loggedUnconfigured = false
  for (const bucket of buckets.values()) {
    const visibility = audienceVisibility(bucket.audience)
    if (!visibility || !isRole(bucket.role) || !canRead(bucket.role, visibility, "", bucket.userId)) continue
    if (!bucket.remindersOn) continue
    const quiet =
      bucket.quietStart && bucket.quietEnd ? { start: bucket.quietStart, end: bucket.quietEnd } : null
    if (isQuiet(now, quiet)) continue
    const badge = bucket.badge ? await openDueCount(env, bucket, due) : null
    let sent = false
    for (const token of bucket.tokens) {
      const outcome = await sendAlert(env, {
        token: token.token,
        environment: token.environment,
        title: "Lembrete",
        body: bucket.title,
        reminderId: bucket.reminderId,
        sound: bucket.sound,
        badge,
      })
      if (outcome === "sent") sent = true
      if (outcome === "gone") {
        await env.DB.prepare("DELETE FROM push_tokens WHERE id = ?").bind(token.id).run()
      }
      if (outcome === "unconfigured" && !loggedUnconfigured) {
        loggedUnconfigured = true
        console.error(JSON.stringify({ error: "ApnsUnconfigured" }))
      }
    }
    if (!sent) continue
    await env.DB.prepare(
      "INSERT OR IGNORE INTO reminder_deliveries (reminder_id, user_id, sent_at) VALUES (?, ?, ?)",
    )
      .bind(bucket.reminderId, bucket.userId, now.toISOString())
      .run()
  }
}

async function openDueCount(env: Env, bucket: Bucket, due: string): Promise<number> {
  const seesAdults = isRole(bucket.role) && canRead(bucket.role, "adults", "", bucket.userId)
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM reminders
     WHERE household_id = ? AND status = 'open' AND due_at <= ?
       AND (audience = 'household' OR ? = 1)`,
  )
    .bind(bucket.householdId, due, seesAdults ? 1 : 0)
    .first<{ n: number }>()
  return row?.n ?? 1
}
