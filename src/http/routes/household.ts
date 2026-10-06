import type { Context } from "hono"
import { Hono } from "hono"
import { createEntity } from "../../application/agent/sql"
import { CODE_SECONDS, generateCode, hashCode } from "../../application/auth/codes"
import { expiresAt, readSession } from "../../application/auth/session"
import { renameHousehold } from "../../application/auth/account"
import { createInvite, hasHousehold, loadMe } from "../../application/auth/store"
import { normalizeAlias } from "../../domain/alias"
import type { Role } from "../../domain/types"
import type { AppEnv } from "../app"

type HouseholdEnv = AppEnv

const INVALID = "Dados inválidos."
const UNAUTHORIZED = "Sessão em falta."
const FORBIDDEN = "Não podes fazer isto."
const UNAVAILABLE = "Falhou. Tenta outra vez."
const EXISTS = "Esse nome já existe."

export function registerHousehold(app: Hono<HouseholdEnv>): void {
  app.get("/api/setup", (c) => setup(c))
  app.get("/api/household", (c) => household(c))
  app.patch("/api/household", (c) => patchHousehold(c))
  app.post("/api/household/members", (c) => addMember(c))
  app.post("/api/household/vehicles", (c) => addVehicle(c))
}

async function setup(c: Context<HouseholdEnv>) {
  const ready = await hasHousehold(c.env.DB)
  return c.json({ needsBootstrap: !ready })
}

async function household(c: Context<HouseholdEnv>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  const members = await c.env.DB.prepare(
    `SELECT id, display_name, role FROM users
     WHERE household_id = ? AND removed_at IS NULL
     ORDER BY display_name`,
  )
    .bind(session.householdId)
    .all<{ id: string; display_name: string; role: Role }>()
  const vehicles = await c.env.DB.prepare(
    `SELECT id, name FROM entities
     WHERE household_id = ? AND kind = 'vehicle' AND status = 'active'
     ORDER BY name`,
  )
    .bind(session.householdId)
    .all<{ id: string; name: string }>()
  return c.json({
    members: members.results.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      role: row.role,
    })),
    vehicles: vehicles.results,
  })
}

async function patchHousehold(c: Context<HouseholdEnv>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  if (session.role !== "owner") return fail(c, 403, "forbidden", FORBIDDEN)
  const body = await readJson(c)
  const name = readName(body?.name)
  if (!name) return fail(c, 400, "validation", INVALID)
  const renamed = await renameHousehold(c.env.DB, session.householdId, name)
  if (!renamed) return fail(c, 404, "not_found", "Não encontrado.")
  const profile = await loadMe(c.env.DB, session.userId, session.householdId)
  if (!profile) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  return c.json(profile.household)
}

async function addMember(c: Context<HouseholdEnv>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  if (session.role !== "owner") return fail(c, 403, "forbidden", FORBIDDEN)
  const pepper = c.env.PIN_PEPPER
  if (!pepper) return fail(c, 503, "unavailable", UNAVAILABLE)
  const body = await readJson(c)
  const displayName = readName(body?.displayName)
  const role = readMemberRole(body?.role)
  if (!displayName || !role) return fail(c, 400, "validation", INVALID)
  const now = new Date()
  const code = generateCode()
  await createInvite(c.env.DB, {
    userId: crypto.randomUUID(),
    householdId: session.householdId,
    displayName,
    role,
    phone: null,
    codeHash: await hashCode("invite", code, pepper),
    now: now.toISOString(),
    expiresAt: expiresAt(now, CODE_SECONDS),
  })
  return c.json({ displayName, role, code })
}

async function addVehicle(c: Context<HouseholdEnv>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  if (session.role !== "owner" && session.role !== "adult") {
    return fail(c, 403, "forbidden", FORBIDDEN)
  }
  const body = await readJson(c)
  const name = readName(body?.name)
  if (!name) return fail(c, 400, "validation", INVALID)
  const alias = readName(body?.alias)
  const normalized = normalizeAlias(name)
  if (!normalized) return fail(c, 400, "validation", INVALID)
  try {
    const entity = await createEntity(c.env.DB, session.householdId, "vehicle", name, normalized)
    if (alias) {
      const extra = normalizeAlias(alias)
      if (extra && extra !== normalized) {
        await c.env.DB.prepare(
          "INSERT INTO aliases (id, household_id, entity_id, normalized) VALUES (?, ?, ?, ?)",
        )
          .bind(crypto.randomUUID(), session.householdId, entity.id, extra)
          .run()
      }
    }
    return c.json({ id: entity.id, name: entity.name })
  } catch {
    return fail(c, 400, "validation", EXISTS)
  }
}

async function requireSession(c: Context<HouseholdEnv>) {
  const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
  if (!session) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  return session
}

function readMemberRole(value: unknown): Exclude<Role, "owner"> | null {
  if (value === "adult" || value === "member" || value === "child") return value
  return null
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (name.length < 1 || name.length > 80) return null
  return name
}

async function readJson(c: Context<HouseholdEnv>): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    if (!body || typeof body !== "object") return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

function fail(
  c: Context,
  status: 400 | 401 | 403 | 404 | 503,
  code: "validation" | "unauthorized" | "forbidden" | "not_found" | "unavailable",
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}
