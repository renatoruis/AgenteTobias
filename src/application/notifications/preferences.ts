export const THEMES = ["system", "light", "dark"] as const
export const ACCENTS = ["teal", "blue", "green", "orange"] as const

export type Theme = (typeof THEMES)[number]
export type Accent = (typeof ACCENTS)[number]

export type QuietHours = { start: string; end: string }

export type Preferences = {
  appearance: { theme: Theme; accent: Accent }
  voice: { speakReplies: boolean; rate: number }
  notifications: {
    reminders: boolean
    sound: boolean
    badge: boolean
    quietHours: QuietHours | null
  }
}

const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/

export function defaultPreferences(): Preferences {
  return {
    appearance: { theme: "system", accent: "teal" },
    voice: { speakReplies: false, rate: 0.5 },
    notifications: { reminders: true, sound: true, badge: true, quietHours: null },
  }
}

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value)
}

function isAccent(value: unknown): value is Accent {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value)
}

function isBool(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function quietHours(value: unknown): QuietHours | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.start !== "string" || typeof row.end !== "string") return undefined
  if (!HOUR.test(row.start) || !HOUR.test(row.end) || row.start === row.end) return undefined
  return { start: row.start, end: row.end }
}

export function parsePreferences(body: unknown): Preferences | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const row = body as Record<string, unknown>
  const appearance = row.appearance
  const voice = row.voice
  const notifications = row.notifications
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) return null
  if (!voice || typeof voice !== "object" || Array.isArray(voice)) return null
  if (!notifications || typeof notifications !== "object" || Array.isArray(notifications)) return null
  const look = appearance as Record<string, unknown>
  const speech = voice as Record<string, unknown>
  const alerts = notifications as Record<string, unknown>
  if (!isTheme(look.theme) || !isAccent(look.accent)) return null
  if (!isBool(speech.speakReplies) || typeof speech.rate !== "number" || !Number.isFinite(speech.rate)) {
    return null
  }
  if (speech.rate < 0 || speech.rate > 1) return null
  if (!isBool(alerts.reminders) || !isBool(alerts.sound) || !isBool(alerts.badge)) return null
  const quiet = quietHours(alerts.quietHours)
  if (quiet === undefined) return null
  return {
    appearance: { theme: look.theme, accent: look.accent },
    voice: { speakReplies: speech.speakReplies, rate: speech.rate },
    notifications: {
      reminders: alerts.reminders,
      sound: alerts.sound,
      badge: alerts.badge,
      quietHours: quiet,
    },
  }
}

export type PreferenceRow = {
  theme: string
  accent: string
  speak_replies: number
  speech_rate: number
  notify_reminders: number
  notify_sound: number
  notify_badge: number
  quiet_start: string | null
  quiet_end: string | null
}

export function preferencesFromRow(row: PreferenceRow): Preferences {
  const parsed = parsePreferences({
    appearance: { theme: row.theme, accent: row.accent },
    voice: { speakReplies: row.speak_replies === 1, rate: row.speech_rate },
    notifications: {
      reminders: row.notify_reminders === 1,
      sound: row.notify_sound === 1,
      badge: row.notify_badge === 1,
      quietHours:
        row.quiet_start && row.quiet_end ? { start: row.quiet_start, end: row.quiet_end } : null,
    },
  })
  return parsed ?? defaultPreferences()
}
