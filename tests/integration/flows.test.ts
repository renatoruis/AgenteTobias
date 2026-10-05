import { describe, expect, it } from "vitest"
import { handleMessage } from "../../src/application/agent/handleMessage"
import { listEvents, seedHousehold, seedVehicle, withDb, type TestD1 } from "./d1"

const now = new Date("2026-10-05T12:00:00.000Z")

const flowATool = {
  type: "expense",
  occurredAt: "hoje",
  visibility: "household",
  data: { amountMinor: 8000, currency: "EUR" },
  entityName: "Continente",
  entityKind: "merchant",
}

type AiCall = { model: unknown; inputs: unknown; options: unknown }

function fakeAi(body: unknown) {
  const calls: AiCall[] = []
  return {
    calls,
    run: async (model: unknown, inputs: unknown, options: unknown) => {
      calls.push({ model, inputs, options })
      return body
    },
  }
}

function toolResponse(name: string, args: unknown) {
  return { tool_calls: [{ name, arguments: args }] }
}

function testEnv(
  db: TestD1,
  run: (model: unknown, inputs: unknown, options: unknown) => Promise<unknown>,
) {
  return {
    DB: db,
    FILES: {},
    VECTORS: {},
    ASSETS: { fetch: async () => new Response("ok") },
    AI: { run },
    AI_GATEWAY_ID: "agentetobias",
    AI_INTERPRET_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
    AI_STT_MODEL: "@cf/openai/whisper-large-v3-turbo",
    AI_EMBED_MODEL: "@cf/baai/bge-m3",
    EMBEDDINGS: "0",
    BOOTSTRAP_TOKEN: "test",
    PIN_PEPPER: "test",
  }
}

describe("message flows", () => {
  it("records the Continente expense from the record_event fake", async () => {
    await withDb(async (db) => {
      const householdId = crypto.randomUUID()
      const userId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      await seedHousehold(db, { householdId, userId, deviceId, name: "Casa" })

      const ai = fakeAi(toolResponse("record_event", flowATool))
      const response = await handleMessage(
        testEnv(db, ai.run),
        { userId, householdId, role: "owner", deviceId },
        { clientMessageId: crypto.randomUUID(), text: "gastei 80 euros no Continente" },
        now,
      )

      expect(response.reply).toBe("Registrei €80 no Continente.")
      expect(response.idempotent).toBe(false)
      expect(ai.calls).toHaveLength(1)
      expect(ai.calls[0]?.model).toBe("@cf/qwen/qwen3-30b-a3b-fp8")
      expect(ai.calls[0]?.options).toMatchObject({ gateway: { id: "agentetobias" } })

      const events = await listEvents(db, householdId)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: "expense",
        status: "active",
        amount_minor: 8000,
        currency: "EUR",
        visibility: "household",
      })
    })
  })

  it("keeps a single event when the same client_message_id is posted twice", async () => {
    await withDb(async (db) => {
      const householdId = crypto.randomUUID()
      const userId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      await seedHousehold(db, { householdId, userId, deviceId, name: "Casa" })
      const ai = fakeAi(toolResponse("record_event", flowATool))
      const env = testEnv(db, ai.run)
      const session = { userId, householdId, role: "owner" as const, deviceId }
      const input = { clientMessageId: crypto.randomUUID(), text: "gastei 80 euros no Continente" }

      const first = await handleMessage(env, session, input, now)
      const second = await handleMessage(env, session, input, now)

      expect(first.reply).toBe("Registrei €80 no Continente.")
      expect(second.idempotent).toBe(true)
      expect(second.reply).toBe(first.reply)
      expect(ai.calls).toHaveLength(1)
      expect(await listEvents(db, householdId)).toHaveLength(1)
    })
  })

  it("asks which car and writes no event", async () => {
    await withDb(async (db) => {
      const householdId = crypto.randomUUID()
      const userId = crypto.randomUUID()
      const deviceId = crypto.randomUUID()
      await seedHousehold(db, { householdId, userId, deviceId, name: "Casa" })
      await seedVehicle(db, {
        householdId,
        entityId: crypto.randomUUID(),
        aliasId: crypto.randomUUID(),
        name: "i30",
        normalized: "i30",
      })
      await seedVehicle(db, {
        householdId,
        entityId: crypto.randomUUID(),
        aliasId: crypto.randomUUID(),
        name: "Aveo",
        normalized: "aveo",
      })

      const ai = fakeAi(
        toolResponse("ask_clarification", { question: "Foi o i30 ou o Aveo?" }),
      )
      const response = await handleMessage(
        testEnv(db, ai.run),
        { userId, householdId, role: "owner", deviceId },
        { clientMessageId: crypto.randomUUID(), text: "abasteci o carro" },
        now,
      )

      expect(response.status).toBe("clarification")
      expect(response.reply).toBe("Foi o i30 ou o Aveo?")
      expect(response.events).toEqual([])
      expect(response.clarification).toEqual({ question: "Foi o i30 ou o Aveo?" })
      expect(await listEvents(db, householdId)).toHaveLength(0)
    })
  })
})
