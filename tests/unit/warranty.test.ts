import { describe, expect, it } from "vitest"
import { warrantyEndsOn } from "../../src/domain/warranty"

const zone = "Europe/Lisbon"

describe("warrantyEndsOn", () => {
  it("adds 24 calendar months from 5 October 2026", () => {
    expect(warrantyEndsOn("2026-10-05", 24, zone)).toBe("2028-10-05")
  })

  it("lands on the last day of a short month", () => {
    expect(warrantyEndsOn("2026-01-31", 1, zone)).toBe("2026-02-28")
    expect(warrantyEndsOn("2024-01-31", 1, zone)).toBe("2024-02-29")
    expect(warrantyEndsOn("2026-03-31", 1, zone)).toBe("2026-04-30")
  })
})
