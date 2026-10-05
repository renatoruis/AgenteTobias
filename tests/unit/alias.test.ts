import { describe, expect, it } from "vitest"
import { normalizeAlias } from "../../src/domain/alias"

describe("normalizeAlias", () => {
  it("treats Continente and continente as the same alias", () => {
    expect(normalizeAlias("Continente")).toBe(normalizeAlias("continente"))
    expect(normalizeAlias("Continente")).toBe("continente")
  })

  it("trims and collapses internal spaces", () => {
    expect(normalizeAlias("  Continente   do   Minho ")).toBe("continente do minho")
  })

  it("strips accents", () => {
    expect(normalizeAlias("José Café")).toBe("jose cafe")
  })

  it("keeps digits", () => {
    expect(normalizeAlias("i30")).toBe("i30")
    expect(normalizeAlias("I30")).toBe("i30")
  })
})
