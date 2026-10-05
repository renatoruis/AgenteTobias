import { describe, expect, it } from "vitest"
import { canRead, canSetVisibility, canVoid } from "../../src/domain/access"

const actor = "actor-1"
const other = "user-2"

describe("canRead", () => {
  it("lets every role read household", () => {
    for (const role of ["owner", "adult", "member", "child"] as const) {
      expect(canRead(role, "household", actor, other)).toBe(true)
    }
  })

  it("lets owner and adult read adults, and refuses member and child", () => {
    expect(canRead("owner", "adults", actor, other)).toBe(true)
    expect(canRead("adult", "adults", actor, other)).toBe(true)
    expect(canRead("member", "adults", actor, other)).toBe(false)
    expect(canRead("child", "adults", actor, other)).toBe(false)
  })

  it("refuses a child the private memory of someone else", () => {
    expect(canRead("child", "private", actor, other)).toBe(false)
  })

  it("lets the author and the owner read private", () => {
    expect(canRead("child", "private", actor, actor)).toBe(true)
    expect(canRead("member", "private", actor, actor)).toBe(true)
    expect(canRead("owner", "private", actor, other)).toBe(true)
    expect(canRead("adult", "private", actor, other)).toBe(false)
    expect(canRead("member", "private", actor, other)).toBe(false)
  })
})

describe("canSetVisibility", () => {
  it("refuses a child adults and another person's private", () => {
    expect(canSetVisibility("child", "adults", actor, other)).toBe(false)
    expect(canSetVisibility("child", "private", actor, other)).toBe(false)
    expect(canSetVisibility("child", "household", actor, actor)).toBe(true)
    expect(canSetVisibility("child", "private", actor, actor)).toBe(true)
  })
})

describe("canVoid", () => {
  it("lets the actor, an owner, or an adult void a household event", () => {
    expect(canVoid("child", "household", actor, actor)).toBe(true)
    expect(canVoid("member", "household", actor, actor)).toBe(true)
    expect(canVoid("adult", "household", actor, other)).toBe(true)
    expect(canVoid("owner", "household", actor, other)).toBe(true)
    expect(canVoid("child", "household", actor, other)).toBe(false)
    expect(canVoid("member", "household", actor, other)).toBe(false)
  })

  it("lets only the author or the owner void a private event", () => {
    expect(canVoid("adult", "private", actor, actor)).toBe(true)
    expect(canVoid("owner", "private", actor, other)).toBe(true)
    expect(canVoid("adult", "private", actor, other)).toBe(false)
    expect(canVoid("child", "private", actor, other)).toBe(false)
  })
})
