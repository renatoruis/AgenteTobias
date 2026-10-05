import { describe, expect, it } from "vitest"
import { parsePreferences } from "../../src/application/notifications/preferences"
import { isQuiet } from "../../src/application/notifications/quiet"

const sample = {
  appearance: { theme: "dark", accent: "blue" },
  voice: { speakReplies: true, rate: 0.4 },
  notifications: {
    reminders: true,
    sound: false,
    badge: true,
    quietHours: { start: "22:00", end: "08:00" },
  },
}

describe("preferences", () => {
  it("aceita o documento completo", () => {
    expect(parsePreferences(sample)?.appearance.accent).toBe("blue")
  })

  it("recusa cor fora do conjunto", () => {
    expect(parsePreferences({ ...sample, appearance: { theme: "dark", accent: "pink" } })).toBeNull()
  })

  it("recusa horas de silêncio iguais", () => {
    expect(
      parsePreferences({
        ...sample,
        notifications: { ...sample.notifications, quietHours: { start: "08:00", end: "08:00" } },
      }),
    ).toBeNull()
  })
})

describe("quiet hours", () => {
  const overnight = { start: "22:00", end: "08:00" }

  it("trata a noite em Lisboa como silêncio", () => {
    expect(isQuiet(new Date("2026-10-05T22:30:00.000Z"), overnight)).toBe(true)
  })

  it("deixa passar o meio-dia", () => {
    expect(isQuiet(new Date("2026-10-05T11:00:00.000Z"), overnight)).toBe(false)
  })

  it("abre o silêncio à hora de fim", () => {
    expect(isQuiet(new Date("2026-10-05T07:00:00.000Z"), overnight)).toBe(false)
  })

  it("aplica um intervalo no mesmo dia", () => {
    expect(isQuiet(new Date("2026-10-05T12:30:00.000Z"), { start: "13:00", end: "15:00" })).toBe(true)
  })

  it("não silencia quando não há intervalo", () => {
    expect(isQuiet(new Date("2026-10-05T22:30:00.000Z"), null)).toBe(false)
  })
})
