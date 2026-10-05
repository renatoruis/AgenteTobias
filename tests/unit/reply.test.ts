import { describe, expect, it } from "vitest"
import { replyFor, replyForClarification, replyForSum, storedReply, summaryFor } from "../../src/domain/reply"

const expense = {
  type: "expense" as const,
  amountMinor: 8000,
  currency: "EUR" as const,
  entityName: "Continente",
  warrantyEndsOn: null,
  summary: "texto livre do modelo",
}

const fuel = {
  type: "vehicle.fuel" as const,
  amountMinor: 7000,
  currency: "EUR" as const,
  entityName: "i30",
  warrantyEndsOn: null,
  summary: "texto livre do modelo",
}

const warranty = {
  type: "warranty" as const,
  amountMinor: null,
  currency: null,
  entityName: "air fryer",
  warrantyEndsOn: "2028-10-05",
  summary: "texto livre do modelo",
}

describe("replyFor", () => {
  it("confirms an expense from the stored event", () => {
    expect(replyFor(expense)).toBe("Registrei €80 no Continente.")
    expect(replyFor(expense)).not.toContain("texto livre")
  })

  it("confirms fuel from the stored event", () => {
    expect(replyFor(fuel)).toBe("Registrei €70 de combustível no i30.")
  })

  it("confirms a warranty purchase with the Lisbon civil date", () => {
    expect(replyFor(warranty)).toBe("Registrei a air fryer, garantia até 5 de outubro de 2028.")
  })

  it("asks which of two vehicles", () => {
    expect(replyForClarification("i30", "Aveo")).toBe("Foi o i30 ou o Aveo?")
  })

  it("reports the SQL sum and the empty month", () => {
    expect(replyForSum(8000)).toBe("€80 este mês.")
    expect(replyForSum(0, "Continente")).toBe("Não há despesas do Continente este mês.")
  })

  it("uses the stored reply when the model is down", () => {
    expect(storedReply()).toBe("Guardado, ainda por interpretar.")
  })
})

describe("summaryFor", () => {
  it("builds the expense summary from the event", () => {
    const summary = summaryFor(expense)
    expect(summary).toContain("Continente")
    expect(summary).toContain("€80")
    expect(summary).not.toContain("texto livre")
  })

  it("builds the fuel summary from the event", () => {
    const summary = summaryFor(fuel)
    expect(summary).toContain("i30")
    expect(summary).toContain("€70")
  })

  it("builds the warranty summary from the event", () => {
    const summary = summaryFor(warranty)
    expect(summary).toContain("air fryer")
    expect(summary).toContain("5 de outubro de 2028")
  })
})
