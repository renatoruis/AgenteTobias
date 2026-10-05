import type { Hono } from "hono"
import { readSession } from "../../application/auth/session"
import type { Env } from "../../env"
import { transcribe } from "../../infrastructure/ai/stt"
import type { AppEnv } from "../app"

const MAX_AUDIO_BYTES = 8 * 1024 * 1024
const AUDIO_TYPES = new Set(["audio/mp4", "audio/mpeg", "audio/webm"])
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ErrorCode = "unauthorized" | "validation" | "unavailable"

function errorBody(code: ErrorCode, message: string) {
  return { error: { code, message } }
}

function mediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

async function recordUsage(
  env: Env,
  traceId: string,
  latencyMs: number,
  errorCode: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO usage (id, trace_id, model, latency_ms, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      traceId,
      env.AI_STT_MODEL,
      latencyMs,
      errorCode,
      new Date().toISOString(),
    )
    .run()
}

export function registerSpeech(app: Hono<AppEnv>): void {
  app.post("/api/speech", async (c) => {
    const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
    if (!session) {
      return c.json(errorBody("unauthorized", "Sessão em falta."), 401)
    }

    const declared = c.req.header("content-length")
    if (declared) {
      const length = Number(declared)
      if (!Number.isFinite(length) || length > MAX_AUDIO_BYTES) {
        return c.json(errorBody("validation", "O áudio passa de 8 MB."), 400)
      }
    }

    let form: Record<string, string | File>
    try {
      form = await c.req.parseBody()
    } catch {
      return c.json(errorBody("validation", "Pedido inválido."), 400)
    }

    const audioPart = form.audio
    const clientMessageId = typeof form.clientMessageId === "string" ? form.clientMessageId.trim() : ""
    if (!(audioPart instanceof Blob) || !UUID_V4.test(clientMessageId)) {
      return c.json(errorBody("validation", "Pedido inválido."), 400)
    }

    const mime = mediaType(audioPart.type)
    if (!AUDIO_TYPES.has(mime)) {
      return c.json(errorBody("validation", "Formato de áudio inválido."), 400)
    }

    if (audioPart.size > MAX_AUDIO_BYTES) {
      return c.json(errorBody("validation", "O áudio passa de 8 MB."), 400)
    }

    const bytes = await audioPart.arrayBuffer()
    if (bytes.byteLength === 0) {
      return c.json(errorBody("validation", "Não ouvi nada."), 400)
    }
    if (bytes.byteLength > MAX_AUDIO_BYTES) {
      return c.json(errorBody("validation", "O áudio passa de 8 MB."), 400)
    }

    const started = Date.now()
    let transcript: string
    try {
      transcript = await transcribe(c.env, bytes, mime)
    } catch {
      await recordUsage(c.env, clientMessageId, Date.now() - started, "unavailable")
      return c.json(errorBody("unavailable", "A voz falhou. Podes escrever."), 503)
    }

    const latencyMs = Date.now() - started
    const text = transcript.trim()
    if (!text) {
      await recordUsage(c.env, clientMessageId, latencyMs, "validation")
      return c.json(errorBody("validation", "Não ouvi nada."), 400)
    }

    await recordUsage(c.env, clientMessageId, latencyMs, null)
    return c.json({ clientMessageId, transcript: text })
  })
}
