import type { Hono } from "hono"
import { readSession } from "../../application/auth/session"
import { canRead } from "../../domain/access"
import type { Session, Visibility } from "../../domain/types"
import type { Env } from "../../env"
import type { AppEnv } from "../app"
import {
  createFileUrl,
  deleteObject,
  fileUrlIsValid,
  objectKey,
  putObject,
  sha256Hex,
} from "../../infrastructure/r2"

const MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"])

type FileRow = {
  id: string
  household_id: string
  event_id: string | null
  r2_key: string
  mime: string
}

type EventAccessRow = {
  visibility: string
  actor_id: string
}

export function registerFiles(app: Hono<AppEnv>): void {
  app.post("/api/files", (c) => postFile(c.env, c.req.raw))
  app.get("/api/files/:id/url", (c) => getFileUrl(c.env, c.req.raw, c.req.param("id")))
}

async function postFile(env: Env, request: Request): Promise<Response> {
  const now = new Date()
  const session = await readSession(env.DB, request.headers.get("cookie"), now)
  if (!session) return error(401, "unauthorized", "Sessão em falta.")

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return error(400, "validation", "Falta o ficheiro.")
  }

  const value = form.get("file")
  if (!(value instanceof Blob)) return error(400, "validation", "Falta o ficheiro.")

  const mime = value.type.split(";")[0]?.trim().toLowerCase() ?? ""
  if (!ALLOWED_MIME.has(mime)) return error(400, "validation", "Tipo de ficheiro não aceite.")
  if (value.size > MAX_BYTES) return error(400, "validation", "O ficheiro ultrapassa 10 MB.")

  const bytes = await value.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) return error(400, "validation", "O ficheiro ultrapassa 10 MB.")

  const fileId = crypto.randomUUID()
  const key = objectKey(session.householdId, fileId)
  const sha256 = await sha256Hex(bytes)

  try {
    await putObject(env.FILES, key, bytes, mime)
  } catch {
    return error(503, "unavailable", "Não consegui guardar o ficheiro.")
  }

  try {
    await env.DB.prepare(
      `INSERT INTO files (id, household_id, event_id, r2_key, mime, bytes, sha256, created_by)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
      .bind(fileId, session.householdId, key, mime, bytes.byteLength, sha256, session.userId)
      .run()
  } catch {
    try {
      await deleteObject(env.FILES, key)
    } catch {
      // Insert did not land. Object may remain until a future sweep.
    }
    return error(503, "unavailable", "Não consegui guardar o ficheiro.")
  }

  return Response.json({ fileId, mime, bytes: bytes.byteLength })
}

async function getFileUrl(env: Env, request: Request, fileId: string): Promise<Response> {
  const now = new Date()
  const url = new URL(request.url)
  const exp = url.searchParams.get("exp")
  const sig = url.searchParams.get("sig")
  if (exp !== null || sig !== null) return download(env, fileId, exp, sig, now)

  const session = await readSession(env.DB, request.headers.get("cookie"), now)
  if (!session) return error(401, "unauthorized", "Sessão em falta.")

  const row = await env.DB.prepare(
    "SELECT id, household_id, event_id, r2_key, mime FROM files WHERE id = ? AND household_id = ?",
  )
    .bind(fileId, session.householdId)
    .first<FileRow>()
  if (!row) return error(404, "not_found", "Não encontrei o ficheiro.")
  if (row.event_id && !(await eventVisible(env, session, row.event_id))) {
    return error(404, "not_found", "Não encontrei o ficheiro.")
  }

  const signed = await createFileUrl(url.origin, row.household_id, row.id, env.PIN_PEPPER, now)
  return Response.json(signed)
}

async function download(
  env: Env,
  fileId: string,
  exp: string | null,
  sig: string | null,
  now: Date,
): Promise<Response> {
  if (!exp || !sig) return error(404, "not_found", "Não encontrei o ficheiro.")

  const row = await env.DB.prepare(
    "SELECT id, household_id, event_id, r2_key, mime FROM files WHERE id = ?",
  )
    .bind(fileId)
    .first<FileRow>()
  if (!row) return error(404, "not_found", "Não encontrei o ficheiro.")

  const allowed = await fileUrlIsValid(row.household_id, row.id, exp, sig, env.PIN_PEPPER, now)
  if (!allowed) return error(404, "not_found", "Não encontrei o ficheiro.")

  const object = await env.FILES.get(row.r2_key)
  if (!object) return error(404, "not_found", "Não encontrei o ficheiro.")

  const headers = new Headers()
  headers.set("content-type", row.mime)
  headers.set("content-length", String(object.size))
  headers.set("cache-control", "private, no-store")
  headers.set("content-disposition", "inline")
  headers.set("x-content-type-options", "nosniff")
  return new Response(object.body, { status: 200, headers })
}

async function eventVisible(env: Env, session: Session, eventId: string): Promise<boolean> {
  const event = await env.DB.prepare(
    "SELECT visibility, actor_id FROM events WHERE id = ? AND household_id = ?",
  )
    .bind(eventId, session.householdId)
    .first<EventAccessRow>()
  if (!event || !isVisibility(event.visibility)) return false
  return canRead(session.role, event.visibility, event.actor_id, session.userId)
}

function isVisibility(value: string): value is Visibility {
  return value === "household" || value === "adults" || value === "private"
}

function error(
  status: 400 | 401 | 404 | 503,
  code: "validation" | "unauthorized" | "not_found" | "unavailable",
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { status })
}
