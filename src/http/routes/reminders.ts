import type { Hono } from "hono"
import { readScope } from "../../domain/access"
import { readSession } from "../../application/auth/session"
import { dbFrom } from "../../infrastructure/d1/client"
import { listReminders } from "../../infrastructure/d1/queries"
import { drizzleDb } from "../../application/agent/sql"
import type { AppEnv } from "../app"

export function registerReminders(app: Hono<AppEnv>): void {
  app.get("/api/reminders", async (c) => {
    const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
    if (!session) {
      return c.json({ error: { code: "unauthorized", message: "Sessão em falta." } }, 401)
    }

    const status = c.req.query("status") ?? "open"
    if (status !== "open" && status !== "done") {
      return c.json({ error: { code: "validation", message: "Pedido inválido." } }, 400)
    }

    const seesAdults = readScope(session.role).visibilities.includes("adults")
    const audienceAllowed = seesAdults
      ? (["household", "adults"] as const)
      : (["household"] as const)

    const rows = await listReminders(dbFrom(drizzleDb(c.env.DB)), session.householdId, audienceAllowed, status)
    const reminders = rows
      .filter((row) => seesAdults || row.audience !== "adults")
      .map((row) => ({
        id: row.id,
        title: row.title,
        dueAt: row.dueAt,
        audience: row.audience,
        eventId: row.eventId,
      }))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))

    return c.json({ reminders })
  })
}
