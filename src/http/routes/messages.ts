import { z } from "zod"
import type { Hono } from "hono"
import { handleMessage } from "../../application/agent/handleMessage"
import { AgentError } from "../../application/agent/errors"
import { readSession } from "../../application/auth/session"
import { embedPending } from "../../infrastructure/search"
import type { AppEnv } from "../app"

const messageBody = z.object({
  clientMessageId: z.uuid(),
  text: z.string().trim().min(1),
  conversationId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  correctsEventId: z.preprocess(emptyToUndefined, z.uuid().optional()),
})

function emptyToUndefined(value: unknown): unknown {
  if (value == null || value === "") return undefined
  return value
}

export function registerMessages(app: Hono<AppEnv>): void {
  app.post("/api/messages", async (c) => {
    const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
    if (!session) {
      return c.json({ error: { code: "unauthorized", message: "Sessão em falta." } }, 401)
    }

    let json: unknown
    try {
      json = await c.req.json()
    } catch {
      return c.json({ error: { code: "validation", message: "Mensagem inválida." } }, 400)
    }

    const parsed = messageBody.safeParse(json)
    if (!parsed.success) {
      return c.json({ error: { code: "validation", message: "Mensagem inválida." } }, 400)
    }

    try {
      const response = await handleMessage(c.env, session, parsed.data, new Date())
      if (c.env.EMBEDDINGS === "1" && response.events.length > 0 && !response.idempotent) {
        c.executionCtx.waitUntil(embedPending(c.env, 5).then(() => undefined, () => undefined))
      }
      return c.json(response)
    } catch (error) {
      if (error instanceof AgentError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status)
      }
      throw error
    }
  })
}
