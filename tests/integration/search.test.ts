import { describe, expect, it } from "vitest"
import { searchEvents } from "../../src/application/search/searchEvents"
import { listEvents, seedExpense, seedHousehold, withDb } from "./d1"

const monthFilter = {
  type: "expense" as const,
  from: "2026-09-30T23:00:00.000Z",
  to: "2026-11-01T00:00:00.000Z",
}

describe("searchEvents", () => {
  it("sums the two expenses seeded in the current month without calling the model", async () => {
    await withDb(async (db) => {
      const householdId = crypto.randomUUID()
      const userId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      await seedHousehold(db, { householdId, userId, deviceId, name: "Casa" })
      await seedExpense(db, {
        householdId,
        userId,
        eventId: crypto.randomUUID(),
        amountMinor: 5000,
        occurredAt: "2026-10-05T12:00:00.000Z",
      })
      await seedExpense(db, {
        householdId,
        userId,
        eventId: crypto.randomUUID(),
        amountMinor: 3000,
        occurredAt: "2026-10-10T12:00:00.000Z",
      })

      const events = await searchEvents(
        db as D1Database,
        { userId, householdId, role: "owner", deviceId },
        monthFilter,
      )
      const sum = events.reduce((total, event) => total + (event.amountMinor ?? 0), 0)

      expect(events).toHaveLength(2)
      expect(sum).toBe(8000)
    })
  })

  it("hides household A from the sum and the event read of household B", async () => {
    await withDb(async (db) => {
      const householdA = crypto.randomUUID()
      const userA = crypto.randomUUID()
      const deviceA = crypto.randomUUID()
      const householdB = crypto.randomUUID()
      const userB = crypto.randomUUID()
      const deviceB = crypto.randomUUID()
      const expenseId = crypto.randomUUID()

      await seedHousehold(db, { householdId: householdA, userId: userA, deviceId: deviceA, name: "Casa A" })
      await seedHousehold(db, { householdId: householdB, userId: userB, deviceId: deviceB, name: "Casa B" })
      await seedExpense(db, {
        householdId: householdA,
        userId: userA,
        eventId: expenseId,
        amountMinor: 8000,
        occurredAt: "2026-10-05T12:00:00.000Z",
      })

      const seenByA = await searchEvents(
        db as D1Database,
        { userId: userA, householdId: householdA, role: "owner", deviceId: deviceA },
        monthFilter,
      )
      const seenByB = await searchEvents(
        db as D1Database,
        { userId: userB, householdId: householdB, role: "owner", deviceId: deviceB },
        monthFilter,
      )
      const sumB = seenByB.reduce((total, event) => total + (event.amountMinor ?? 0), 0)

      expect(seenByA.map((event) => event.id)).toContain(expenseId)
      expect(seenByB.map((event) => event.id)).not.toContain(expenseId)
      expect(sumB).toBe(0)
      expect(await listEvents(db, householdB)).toHaveLength(0)
    })
  })
})
