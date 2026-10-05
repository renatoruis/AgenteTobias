const INVALID_AMOUNT = "invalid amount"

export function parseEur(input: string): number {
  if (typeof input !== "string") throw new Error(INVALID_AMOUNT)

  const text = input
    .trim()
    .toLowerCase()
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")

  if (text.length === 0 || /\bkm\b/i.test(text)) throw new Error(INVALID_AMOUNT)

  const core = text
    .replace(/€/g, " ")
    .replace(/\beuros?\b/g, " ")
    .replace(/\bcontos?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (core.length === 0 || core.includes(" ") || /[a-z]/i.test(core)) {
    throw new Error(INVALID_AMOUNT)
  }

  const cents = euroTextToMinor(core)
  if (cents == null) throw new Error(INVALID_AMOUNT)
  return cents
}

export function formatEur(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : ""
  const abs = Math.abs(Math.trunc(amountMinor))
  const euros = Math.floor(abs / 100)
  const cents = abs % 100
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  if (cents === 0) return `${sign}€${grouped}`
  return `${sign}€${grouped},${String(cents).padStart(2, "0")}`
}

/** Inteiro finito já em cêntimos. Texto passa por `parseEur`. Inválido devolve null. */
export function toAmountMinor(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) return null
    return value
  }
  if (typeof value !== "string") return null
  try {
    return parseEur(value)
  } catch {
    return null
  }
}

function euroTextToMinor(core: string): number | null {
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(core)) {
    const [whole, decimal] = core.split(",")
    return toMinor(whole.replaceAll(".", ""), decimal)
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(core)) return null
  if (/^\d{1,3}(,\d{3})+$/.test(core)) return null
  if (/^\d+,\d{1,2}$/.test(core)) {
    const [whole, decimal] = core.split(",")
    return toMinor(whole, decimal)
  }
  if (/^\d+\.\d{1,2}$/.test(core)) {
    const [whole, decimal] = core.split(".")
    return toMinor(whole, decimal)
  }
  if (/^\d+$/.test(core)) return toMinor(core, "")
  return null
}

function toMinor(whole: string, decimal: string): number | null {
  const euros = Number(whole)
  const cents = decimal.length === 0 ? 0 : decimal.length === 1 ? Number(decimal) * 10 : Number(decimal)
  if (!Number.isSafeInteger(euros) || !Number.isSafeInteger(cents)) return null
  const total = euros * 100 + cents
  if (!Number.isSafeInteger(total)) return null
  return total
}
