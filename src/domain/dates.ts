const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

type CivilDate = { year: number; month: number; day: number }

export function resolveWhen(text: string, now: Date, timeZone: string): Date | null {
  const trimmed = text.trim()
  const iso = parseIsoInstant(trimmed, timeZone)
  if (iso) return iso

  const folded = fold(trimmed)
  const clock = findClock(folded)
  const today = civilFromInstant(now, timeZone)
  if (today.weekday === 0) return null

  const monday = shiftCivilDate(today, -(today.weekday === 7 ? 6 : today.weekday - 1))
  const day = relativeDay(folded, today, monday) ?? (clock ? today : null)
  if (!day) return null

  if (clock) return zonedToUtc(day.year, day.month, day.day, clock.hour, clock.minute, 0, timeZone)
  return startOfCivilDate(day.year, day.month, day.day, timeZone)
}

export function startOfCivilDay(now: Date, timeZone: string): Date {
  const today = civilFromInstant(now, timeZone)
  return startOfCivilDate(today.year, today.month, today.day, timeZone)
}

export function civilDate(now: Date, timeZone: string): string {
  return formatIsoDate(civilFromInstant(now, timeZone))
}

/** Início inclusive e fim exclusivo do mês civil que contém `now`. */
export function civilMonthRange(now: Date, timeZone: string): { from: string; to: string } {
  const today = civilFromInstant(now, timeZone)
  const from = startOfCivilDate(today.year, today.month, 1, timeZone)
  const nextMonth = today.month === 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 }
  const to = startOfCivilDate(nextMonth.year, nextMonth.month, 1, timeZone)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function civilDaysBefore(civil: string, days: number, timeZone: string): string {
  const parsed = parseCivilDate(civil)
  if (!parsed) throw new Error("invalid civil date")
  const shifted = shiftCivilDate(parsed, -days)
  return startOfCivilDate(shifted.year, shifted.month, shifted.day, timeZone).toISOString()
}

export function startOfCivilDate(year: number, month: number, day: number, timeZone: string): Date {
  return zonedToUtc(year, month, day, 0, 0, 0, timeZone)
}

function relativeDay(folded: string, today: CivilDate & { weekday: number }, monday: CivilDate): CivilDate | null {
  const previousMonday = shiftCivilDate(monday, -7)
  if (folded.includes("semana passada") && /\bsabado\b/.test(folded)) {
    return shiftCivilDate(previousMonday, 5)
  }
  if (folded.includes("semana passada")) return previousMonday
  if (/\bontem\b/.test(folded)) return shiftCivilDate(today, -1)
  if (/\bhoje\b/.test(folded)) return today
  if (/\bsabado\b/.test(folded)) return shiftCivilDate(monday, 5)
  return null
}

function parseIsoInstant(text: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(text)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidCivilDate(year, month, day)) return null
  if (match[4] === undefined) return startOfCivilDate(year, month, day, timeZone)

  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? "0")
  if (hour > 23 || minute > 59 || second > 59) return null
  if (match[7]) {
    const instant = new Date(text)
    if (Number.isNaN(instant.getTime())) return null
    return instant
  }
  return zonedToUtc(year, month, day, hour, minute, second, timeZone)
}

function findClock(folded: string): { hour: number; minute: number } | null {
  const match =
    /(?:^|\s)as\s+(\d{1,2}):(\d{2})(?!\d)/.exec(folded) ??
    /\b(\d{1,2}):(\d{2})(?!\d)/.exec(folded) ??
    /\b(\d{1,2})\s*h(?:\s*(\d{2}))?(?!\d)/.exec(folded)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2] ?? "0")
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function civilFromInstant(instant: Date, timeZone: string): CivilDate & { weekday: number } {
  const parts = dateParts(instant, timeZone)
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    weekday: parts.weekday,
  }
}

function dateParts(instant: Date, timeZone: string): CivilDate & { weekday: number; hour: number; minute: number; second: number } {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant)
  const pick = (type: Intl.DateTimeFormatPartTypes) => formatted.find((part) => part.type === type)?.value ?? ""
  let hour = Number(pick("hour"))
  if (hour === 24) hour = 0
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    weekday: WEEKDAYS[pick("weekday")] ?? 0,
    hour,
    minute: Number(pick("minute")),
    second: Number(pick("second")),
  }
}

function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = offsetMs(new Date(guess), timeZone)
  let utc = guess - first
  const secondOffset = offsetMs(new Date(utc), timeZone)
  if (secondOffset !== first) utc = guess - secondOffset
  return new Date(utc)
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = dateParts(instant, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const truncated = Math.floor(instant.getTime() / 1000) * 1000
  return asUtc - truncated
}

export function shiftCivilDate(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

export function parseCivilDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!isValidCivilDate(year, month, day)) return null
  return { year, month, day }
}

function formatIsoDate(date: CivilDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

function isValidCivilDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
}
