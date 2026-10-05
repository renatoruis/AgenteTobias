import { describe, expect, it } from "vitest"
import { parseKilometers } from "../../src/domain/numbers"

describe("parseKilometers", () => {
  it.each(["18450", "18.450", "18,450"])("parses %s as 18450", (text) => {
    expect(parseKilometers(text)).toBe(18450)
  })
})
