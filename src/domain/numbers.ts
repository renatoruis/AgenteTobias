const INVALID_KILOMETERS = "invalid kilometers"

export function parseKilometers(input: string): number {
  if (typeof input !== "string") throw new Error(INVALID_KILOMETERS)

  const text = input
    .trim()
    .toLowerCase()
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*km$/i, "")
    .trim()

  let digits: string | null = null
  if (/^\d+$/.test(text)) digits = text
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) digits = text.replaceAll(".", "")
  else if (/^\d{1,3}(,\d{3})+$/.test(text)) digits = text.replaceAll(",", "")

  if (digits == null) throw new Error(INVALID_KILOMETERS)
  const value = Number(digits)
  if (!Number.isSafeInteger(value)) throw new Error(INVALID_KILOMETERS)
  return value
}
