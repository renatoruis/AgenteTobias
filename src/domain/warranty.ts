import { daysInMonth, parseCivilDate, startOfCivilDate } from "./dates"

export function warrantyEndsOn(purchaseDate: string, months: number, timeZone: string): string {
  const start = purchaseCivilDate(purchaseDate, timeZone)
  if (!start || !Number.isInteger(months)) throw new Error("invalid warranty")

  const monthIndex = start.month - 1 + months
  const year = start.year + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  const day = Math.min(start.day, daysInMonth(year, month + 1))
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

export function warrantyReminderDueAt(endsOn: string, timeZone: string): string {
  const end = parseCivilDate(endsOn)
  if (!end) throw new Error("invalid warranty end")
  const due = addCalendarDays(end.year, end.month, end.day, -30)
  return startOfCivilDate(due.year, due.month, due.day, timeZone).toISOString()
}

export function warrantyReminderTitle(name: string): string {
  return `Garantia da ${name}`
}

function purchaseCivilDate(
  purchaseDate: string,
  timeZone: string,
): { year: number; month: number; day: number } | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(purchaseDate.trim())
  if (dateOnly) return parseCivilDate(dateOnly[0])

  const instant = new Date(purchaseDate)
  if (Number.isNaN(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  const year = pick("year")
  const month = pick("month")
  const day = pick("day")
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  return { year, month, day }
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}
