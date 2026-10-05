import { describe, expect, it } from "vitest"
import { isToolName, parseTool, toolSchemas } from "../../src/domain/tools"

describe("tool schemas", () => {
  it("exposes exactly the five tools the model is given", () => {
    expect(Object.keys(toolSchemas)).toEqual(["remember", "recall", "total", "amend", "void"])
    expect(isToolName("remember")).toBe(true)
    expect(isToolName("record_event")).toBe(false)
  })

  it("accepts a remember call with cents, entities and warranty months", () => {
    const parsed = parseTool("remember", {
      text: "comprei um frigorífico na Worten",
      type: "purchase",
      amountMinor: 59900,
      occurredAt: "hoje",
      entities: [{ name: "Worten", kind: "merchant" }],
      warrantyMonths: 36,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ type: "purchase", amountMinor: 59900, warrantyMonths: 36 })
    }
  })

  it("rejects negative cents, unknown types and empty text", () => {
    expect(parseTool("remember", { text: "x", type: "expense", amountMinor: -1 }).success).toBe(false)
    expect(parseTool("remember", { text: "x", type: "salary" }).success).toBe(false)
    expect(parseTool("remember", { text: "  ", type: "note" }).success).toBe(false)
  })

  it("accepts income as an event type", () => {
    expect(parseTool("remember", { text: "vendi o teclado", type: "income", amountMinor: 60000 }).success).toBe(true)
  })

  it("caps recall at 12 results and requires a uuid for amend and void", () => {
    expect(parseTool("recall", { query: "água", limit: 50 }).success).toBe(false)
    expect(parseTool("recall", { query: "água", limit: 5 }).success).toBe(true)
    expect(parseTool("void", { eventId: "not-a-uuid" }).success).toBe(false)
    expect(parseTool("amend", { eventId: crypto.randomUUID(), amountMinor: 1200 }).success).toBe(true)
  })
})
