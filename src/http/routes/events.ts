import type { Hono } from "hono"
import { readSession } from "../../application/auth/session"
import { voidFact } from "../../application/agent/sql"
import type { AppEnv } from "../app"

export function registerEvents(app: Hono<AppEnv>): void {
  app.post("/api/events/:id/void", async (c) => {
    const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
    if (!session) {
      return c.json({ error: { code: "unauthorized", message: "Sessão em falta." } }, 401)
    }

    const outcome = await voidFact(c.env, session, c.req.param("id"))
    if (!outcome.ok) {
      const code = outcome.status === 403 ? "forbidden" : "not_found"
      return c.json({ error: { code, message: outcome.message } }, outcome.status)
    }
    return c.json({ id: outcome.id, status: "voided" })
  })
}
