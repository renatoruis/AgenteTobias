import type { Context } from "hono"
import type { Hono } from "hono"
import {
  findSessionOwner,
  listDeviceSessions,
  listUsers,
  loadPreferences,
  readPreferencesBody,
  renameUser,
  savePreferences,
  savePushToken,
} from "../../application/auth/account"
import { loadMe, revokeSession } from "../../application/auth/store"
import { readCookie, readSession, SESSION_COOKIE } from "../../application/auth/session"
import type { Env } from "../../env"
import type { Session } from "../../domain/types"

type AccountEnv = { Bindings: Env }

const SESSION_MISSING = "Sessão em falta."
const INVALID = "Pedido inválido."
const FORBIDDEN = "Não tens permissão."
const NOT_FOUND = "Não encontrado."

function fail(
  c: Context,
  status: 400 | 401 | 403 | 404,
  code: "validation" | "unauthorized" | "forbidden" | "not_found",
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

function cookieHeader(c: Context): string | null {
  return c.req.header("Cookie") ?? null
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (name.length < 1 || name.length > 80) return null
  return name
}

async function requireSession<E extends AccountEnv>(c: Context<E>, now: Date): Promise<Session | Response> {
  const session = await readSession(c.env.DB, cookieHeader(c), now)
  if (!session) return fail(c, 401, "unauthorized", SESSION_MISSING)
  return session
}

export function registerAccount<E extends AccountEnv>(app: Hono<E>): void {
  app.get("/api/users", (c) => users(c))
  app.patch("/api/me", (c) => patchMe(c))
  app.get("/api/me/preferences", (c) => getPreferences(c))
  app.put("/api/me/preferences", (c) => putPreferences(c))
  app.get("/api/sessions", (c) => sessions(c))
  app.post("/api/sessions/:id/revoke", (c) => revoke(c))
  app.put("/api/devices/current/push", (c) => push(c))
}

async function users<E extends AccountEnv>(c: Context<E>) {
  const session = await requireSession(c, new Date())
  if (session instanceof Response) return session
  return c.json({ users: await listUsers(c.env.DB, session.householdId) })
}

async function patchMe<E extends AccountEnv>(c: Context<E>) {
  const session = await requireSession(c, new Date())
  if (session instanceof Response) return session
  const body = await readJson(c)
  const displayName = readName(body?.displayName)
  if (!displayName) return fail(c, 400, "validation", INVALID)
  const renamed = await renameUser(c.env.DB, session.userId, session.householdId, displayName)
  if (!renamed) return fail(c, 404, "not_found", NOT_FOUND)
  const profile = await loadMe(c.env.DB, session.userId, session.householdId)
  if (!profile) return fail(c, 401, "unauthorized", SESSION_MISSING)
  return c.json(profile)
}

async function getPreferences<E extends AccountEnv>(c: Context<E>) {
  const session = await requireSession(c, new Date())
  if (session instanceof Response) return session
  return c.json(await loadPreferences(c.env.DB, session.userId))
}

async function putPreferences<E extends AccountEnv>(c: Context<E>) {
  const session = await requireSession(c, new Date())
  if (session instanceof Response) return session
  const preferences = readPreferencesBody(await c.req.json().catch(() => null))
  if (!preferences) return fail(c, 400, "validation", INVALID)
  await savePreferences(c.env.DB, session.userId, preferences)
  return c.json(preferences)
}

async function sessions<E extends AccountEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  const current = readCookie(cookieHeader(c), SESSION_COOKIE)
  const rows = await listDeviceSessions(c.env.DB, session.householdId, session.userId, session.role, now.toISOString())
  return c.json({
    sessions: rows.map((row) => ({
      id: row.id,
      deviceName: row.deviceName,
      current: row.id === current,
    })),
  })
}

async function revoke<E extends AccountEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  const sessionId = c.req.param("id")
  if (!sessionId) return fail(c, 404, "not_found", NOT_FOUND)
  const target = await findSessionOwner(c.env.DB, sessionId)
  if (!target || target.revoked || target.householdId !== session.householdId) {
    return fail(c, 404, "not_found", NOT_FOUND)
  }
  if (session.role !== "owner" && target.userId !== session.userId) {
    return fail(c, 403, "forbidden", FORBIDDEN)
  }
  await revokeSession(c.env.DB, sessionId, now.toISOString())
  return c.body(null, 204)
}

async function push<E extends AccountEnv>(c: Context<E>) {
  const session = await requireSession(c, new Date())
  if (session instanceof Response) return session
  const body = await readJson(c)
  const token = body && typeof body.token === "string" ? body.token.trim() : ""
  const environment = body && typeof body.environment === "string" ? body.environment : ""
  const saved = await savePushToken(c.env.DB, {
    id: crypto.randomUUID(),
    deviceId: session.deviceId,
    userId: session.userId,
    token,
    environment,
    updatedAt: new Date().toISOString(),
  })
  if (!saved) return fail(c, 400, "validation", INVALID)
  return c.body(null, 204)
}
