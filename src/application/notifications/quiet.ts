import type { QuietHours } from "./preferences"

export function isQuiet(now: Date, quiet: QuietHours | null, timeZone = "Europe/Lisbon"): boolean {
  if (!quiet) return false
  const start = minutesOf(quiet.start)
  const end = minutesOf(quiet.end)
  if (start === null || end === null || start === end) return false
  const current = localMinutes(now, timeZone)
  if (current === null) return false
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

function minutesOf(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function localMinutes(now: Date, timeZone: string): number | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const hour = parts.find((part) => part.type === "hour")?.value
  const minute = parts.find((part) => part.type === "minute")?.value
  if (!hour || !minute) return null
  return Number(hour) * 60 + Number(minute)
}
