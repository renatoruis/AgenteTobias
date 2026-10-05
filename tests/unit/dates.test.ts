import { describe, expect, it } from "vitest"
import { clockQuestion, clockReply, replyIfClock, resolveWhen } from "../../src/domain/dates"

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

describe("clock", () => {
  const afternoon = new Date("2026-10-05T12:00:00.000Z")

  it("recognises the date, the weekday and the time", () => {
    expect(clockQuestion("Que dia é hoje?")).toBe("date")
    expect(clockQuestion("que dia da semana")).toBe("weekday")
    expect(clockQuestion("Que horas são?")).toBe("time")
    expect(clockQuestion("Hoje fizemos o cadastro")).toBeNull()
  })

  it("answers from the Lisbon clock", () => {
    expect(clockReply("date", afternoon, zone)).toBe("Hoje é segunda-feira, 5 de outubro de 2026.")
    expect(clockReply("time", afternoon, zone)).toBe("São 13:00.")
  })

  it("replaces a model question that admits it does not know the day", () => {
    expect(replyIfClock("olá", "Não consigo saber o dia atual.", afternoon, zone)).toBe(
      "Hoje é segunda-feira, 5 de outubro de 2026.",
    )
  })
})
