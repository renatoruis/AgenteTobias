import { describe, expect, it } from "vitest"
import { handleMessage } from "../../src/application/agent/handleMessage"
import { listEvents, seedExpense, seedHousehold, seedVehicle, withDb, type TestD1 } from "./d1"

const now = new Date("2026-10-05T12:00:00.000Z")

type AiCall = { model: unknown; inputs: unknown; options: unknown }

/** OpenAI chat-completion shapes, the way the gateway returns them for `openai/*` and `google-ai-studio/*`. */
function toolCall(name: string, args: unknown, id = "call_1") {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 40 },
  }
}

function textReply(content: string) {
  return {
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 1000, completion_tokens: 20 },
  }
}

/** Each call returns the next scripted body. A function entry may throw to simulate a provider failure. */
function fakeAi(script: Array<unknown | (() => unknown)>) {
  const calls: AiCall[] = []
  return {
    calls,
    run: async (model: unknown, inputs: unknown, options: unknown) => {
      calls.push({ model, inputs, options })
      const next = script[calls.length - 1] ?? script[script.length - 1]
      return typeof next === "function" ? (next as () => unknown)() : next
    },
  }
}

function testEnv(
  db: TestD1,
  run: (model: unknown, inputs: unknown, options: unknown) => Promise<unknown>,
  overrides: Record<string, string> = {},
) {
  return {
    DB: db,
    FILES: {},
    VECTORS: {},
    AI: { run },
    AI_GATEWAY_ID: "agentetobias",
    AI_INTERPRET_MODEL: "openai/gpt-5-mini",
    AI_FALLBACK_MODEL: "google-ai-studio/gemini-2.5-flash-lite",
    AI_STT_MODEL: "@cf/openai/whisper-large-v3-turbo",
    AI_EMBED_MODEL: "@cf/baai/bge-m3",
    EMBEDDINGS: "0",
    CONFIRM_ABOVE_MINOR: "50000",
    APNS_BUNDLE_ID: "br.com.timdevops.tobias",
    BOOTSTRAP_TOKEN: "test",
    PIN_PEPPER: "test",
    ...overrides,
  }
}

async function seed(db: TestD1) {
  const householdId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const deviceId = crypto.randomUUID()
  await seedHousehold(db, { householdId, userId, deviceId, name: "Renato" })
  return { householdId, userId, deviceId, session: { userId, householdId, role: "owner" as const, deviceId } }
}

function lastInputs(ai: ReturnType<typeof fakeAi>) {
  return ai.calls[ai.calls.length - 1]?.inputs as { messages: Array<Record<string, unknown>>; tools: unknown[] }
}

describe("message flows", () => {
  it("records the Continente expense: remember tool, then the model writes the reply", async () => {
    await withDb(async (db) => {
      const { householdId, session } = await seed(db)
      const ai = fakeAi([
        toolCall("remember", {
          text: "gastei 80 euros no Continente",
          type: "expense",
          occurredAt: "hoje",
          amountMinor: 8000,
          entities: [{ name: "Continente", kind: "merchant" }],
        }),
        textReply("Anotado, €80 no Continente."),
      ])

      const response = await handleMessage(
        testEnv(db, ai.run),
        session,
        { clientMessageId: crypto.randomUUID(), text: "gastei 80 euros no Continente" },
        now,
      )

      expect(response.status).toBe("interpreted")
      expect(response.reply).toBe("Anotado, €80 no Continente.")
      expect(response.events).toHaveLength(1)
      expect(response.events[0]).toMatchObject({ type: "expense", amountMinor: 8000, currency: "EUR" })
      expect(response.idempotent).toBe(false)

      expect(ai.calls).toHaveLength(2)
      expect(ai.calls[0]?.model).toBe("openai/gpt-5-mini")
      expect(ai.calls[0]?.options).toMatchObject({ gateway: { id: "agentetobias" } })
      const first = ai.calls[0]?.inputs as { tool_choice: string; tools: Array<{ function: { name: string } }> }
      expect(first.tool_choice).toBe("auto")
      expect(first.tools.map((tool) => tool.function.name)).toEqual(["remember", "recall", "total", "amend", "void"])

      const second = lastInputs(ai)
      const toolMessage = second.messages.find((message) => message.role === "tool")
      expect(toolMessage).toMatchObject({ tool_call_id: "call_1" })
      expect(JSON.parse(String(toolMessage?.content))).toMatchObject({
        saved: { type: "expense", amountMinor: 8000 },
        entity: "Continente",
      })

      const events = await listEvents(db, householdId)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: "expense", status: "active", amount_minor: 8000, visibility: "household" })
    })
  })

  it("keeps a single event when the same client_message_id is posted twice", async () => {
    await withDb(async (db) => {
      const { householdId, session } = await seed(db)
      const ai = fakeAi([
        toolCall("remember", { text: "gastei 80 euros no Continente", type: "expense", amountMinor: 8000 }),
        textReply("Anotado."),
      ])
      const env = testEnv(db, ai.run)
      const input = { clientMessageId: crypto.randomUUID(), text: "gastei 80 euros no Continente" }

      const first = await handleMessage(env, session, input, now)
      const second = await handleMessage(env, session, input, now)

      expect(first.status).toBe("interpreted")
      expect(second.idempotent).toBe(true)
      expect(second.reply).toBe(first.reply)
      expect(second.events).toEqual(first.events)
      expect(ai.calls).toHaveLength(2)
      expect(await listEvents(db, householdId)).toHaveLength(1)
    })
  })

  it("returns ambiguous_vehicle to the model and writes nothing when two cars match", async () => {
    await withDb(async (db) => {
      const { householdId, session } = await seed(db)
      for (const name of ["i30", "Aveo"]) {
        await seedVehicle(db, {
          householdId,
          entityId: crypto.randomUUID(),
          aliasId: crypto.randomUUID(),
          name,
          normalized: name.toLowerCase(),
        })
      }

      const ai = fakeAi([
        toolCall("remember", {
          text: "abasteci o carro",
          type: "vehicle.fuel",
          amountMinor: 5000,
          entities: [{ name: "carro", kind: "vehicle" }],
        }),
        textReply("Foi o i30 ou o Aveo?"),
      ])
      const response = await handleMessage(
        testEnv(db, ai.run),
        session,
        { clientMessageId: crypto.randomUUID(), text: "abasteci o carro, 50 euros" },
        now,
      )

      expect(response.status).toBe("interpreted")
      expect(response.reply).toBe("Foi o i30 ou o Aveo?")
      expect(response.events).toEqual([])
      const toolMessage = lastInputs(ai).messages.find((message) => message.role === "tool")
      const payload = JSON.parse(String(toolMessage?.content)) as { error: string; options: string[] }
      expect(payload.error).toBe("ambiguous_vehicle")
      expect(payload.options.sort()).toEqual(["Aveo", "i30"])
      expect(await listEvents(db, householdId)).toHaveLength(0)
    })
  })

  it("answers the date without calling the model", async () => {
    await withDb(async (db) => {
      const { session } = await seed(db)
      const ai = fakeAi([textReply("não devia ser chamado")])
      const response = await handleMessage(
        testEnv(db, ai.run),
        session,
        { clientMessageId: crypto.randomUUID(), text: "Que dia é hoje?" },
        now,
      )
      expect(response.status).toBe("interpreted")
      expect(response.reply).toBe("Hoje é segunda-feira, 5 de outubro de 2026.")
      expect(response.events).toEqual([])
      expect(ai.calls).toHaveLength(0)
    })
  })

  it("asks before saving above CONFIRM_ABOVE_MINOR and saves on sim without a second model call", async () => {
    await withDb(async (db) => {
      const { householdId, session } = await seed(db)
      const ai = fakeAi([
        toolCall("remember", {
          text: "vendi o teclado por 600 euros",
          type: "income",
          occurredAt: "hoje",
          amountMinor: 60000,
        }),
      ])
      const env = testEnv(db, ai.run)

      const first = await handleMessage(
        env,
        session,
        { clientMessageId: crypto.randomUUID(), text: "vendi o teclado por 600 euros" },
        now,
      )
      expect(first.status).toBe("proposal")
      expect(first.reply).toBe("Entendi: €600 recebidos. Gravo?")
      expect(first.events).toEqual([])
      expect(ai.calls).toHaveLength(1)
      expect(await listEvents(db, householdId)).toHaveLength(0)

      const second = await handleMessage(
        env,
        session,
        { clientMessageId: crypto.randomUUID(), text: "sim", conversationId: first.conversationId },
        now,
      )
      expect(second.status).toBe("interpreted")
      expect(second.reply).toBe("Registrei €600 recebidos.")
      expect(second.events).toHaveLength(1)
      expect(ai.calls).toHaveLength(1)

      const events = await listEvents(db, householdId)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: "income", amount_minor: 60000, status: "active" })
    })
  })

  it("gives the model a deterministic total", async () => {
    await withDb(async (db) => {
      const { householdId, userId, session } = await seed(db)
      await seedExpense(db, { householdId, userId, eventId: crypto.randomUUID(), amountMinor: 3000, occurredAt: "2026-10-02T10:00:00.000Z" })
      await seedExpense(db, { householdId, userId, eventId: crypto.randomUUID(), amountMinor: 5000, occurredAt: "2026-10-03T10:00:00.000Z" })

      const ai = fakeAi([
        toolCall("total", { type: "expense", from: "2026-10-01", to: "2026-10-31" }),
        textReply("Este mês gastaste €80."),
      ])
      const response = await handleMessage(
        testEnv(db, ai.run),
        session,
        { clientMessageId: crypto.randomUUID(), text: "quanto gastei este mês?" },
        now,
      )

      expect(response.status).toBe("interpreted")
      expect(response.reply).toBe("Este mês gastaste €80.")
      expect(response.events).toEqual([])
      const toolMessage = lastInputs(ai).messages.find((message) => message.role === "tool")
      expect(JSON.parse(String(toolMessage?.content))).toMatchObject({ totalMinor: 8000, formatted: "€80", count: 2 })
    })
  })

  it("falls back to the second model, and stores the text when both fail", async () => {
    await withDb(async (db) => {
      const { householdId, session } = await seed(db)

      const fallbackAi = fakeAi([
        () => {
          throw new Error("upstream 503")
        },
        textReply("Olá! Em que posso ajudar?"),
      ])
      const recovered = await handleMessage(
        testEnv(db, fallbackAi.run),
        session,
        { clientMessageId: crypto.randomUUID(), text: "olá" },
        now,
      )
      expect(recovered.status).toBe("interpreted")
      expect(recovered.reply).toBe("Olá! Em que posso ajudar?")
      expect(fallbackAi.calls.map((call) => call.model)).toEqual([
        "openai/gpt-5-mini",
        "google-ai-studio/gemini-2.5-flash-lite",
      ])

      const brokenAi = fakeAi([
        () => {
          throw new Error("upstream 503")
        },
      ])
      const stored = await handleMessage(
        testEnv(db, brokenAi.run),
        session,
        { clientMessageId: crypto.randomUUID(), text: "paguei a água" },
        now,
      )
      expect(stored.status).toBe("stored")
      expect(stored.reply).toBe("Guardado, ainda por interpretar.")
      expect(stored.events).toEqual([])
      expect(brokenAi.calls).toHaveLength(2)
      expect(await listEvents(db, householdId)).toHaveLength(0)
    })
  })
})
