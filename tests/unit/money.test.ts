import { describe, expect, it } from "vitest"
import { formatEur, parseEur } from "../../src/domain/money"

describe("parseEur", () => {
  it.each([
    ["70", 7000],
    ["70 euros", 7000],
    ["€70", 7000],
    ["70,50", 7050],
    ["70.50", 7050],
    ["70,5", 7050],
    ["70.5", 7050],
    ["70 conto", 7000],
  ])("parses %s as %i cents", (text, cents) => {
    expect(parseEur(text)).toBe(cents)
  })

  it("reads 70.50 as seventy euros and fifty cents", () => {
    expect(parseEur("70.50")).toBe(7050)
    expect(parseEur("70.50")).not.toBe(7_050_000)
  })

  it.each(["18.450", "1.850", "18.450 km"])("rejects %s", (text) => {
    expect(() => parseEur(text)).toThrow()
  })

  it("does not turn 18.450 into 1845000 cents", () => {
    let cents: number | undefined
    try {
      cents = parseEur("18.450")
    } catch {
      cents = undefined
    }
    expect(cents).not.toBe(1_845_000)
  })
})

describe("formatEur", () => {
  it("formats whole euros without decimals", () => {
    expect(formatEur(7000)).toBe("€70")
  })

  it("formats cents with a comma", () => {
    expect(formatEur(7050)).toBe("€70,50")
    expect(formatEur(7005)).toBe("€70,05")
  })
})
