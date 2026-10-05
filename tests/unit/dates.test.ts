import { describe, expect, it } from "vitest"
import { resolveWhen } from "../../src/domain/dates"

const zone = "Europe/Lisbon"

/** 2026-10-05 00:30 in Lisbon (WEST, UTC+1). The UTC calendar date is still the 4th. */
const mondayNight = new Date("2026-10-04T23:30:00.000Z")

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

describe("resolveWhen", () => {
  it("resolves hoje to the start of the Lisbon civil day", () => {
    expect(toIso(resolveWhen("hoje", mondayNight, zone))).toBe("2026-10-04T23:00:00.000Z")
  })

  it("resolves ontem to the previous Lisbon day", () => {
    expect(toIso(resolveWhen("ontem", mondayNight, zone))).toBe("2026-10-03T23:00:00.000Z")
  })

  it("resolves sábado to the Saturday of the current Lisbon week", () => {
    expect(toIso(resolveWhen("sábado", mondayNight, zone))).toBe("2026-10-09T23:00:00.000Z")
  })

  it("keeps sábado as today when today is Saturday", () => {
    const saturday = new Date("2026-10-10T00:30:00.000Z")
    expect(toIso(resolveWhen("sábado", saturday, zone))).toBe("2026-10-09T23:00:00.000Z")
  })

  it("resolves semana passada to Monday of the previous week", () => {
    expect(toIso(resolveWhen("semana passada", mondayNight, zone))).toBe("2026-09-27T23:00:00.000Z")
  })

  it("keeps the clock when the phrase includes an hour", () => {
    expect(toIso(resolveWhen("hoje às 15:30", mondayNight, zone))).toBe("2026-10-05T14:30:00.000Z")
  })
})
