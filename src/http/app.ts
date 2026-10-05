import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import type { Env } from "../env"
import { registerAuth } from "./routes/auth"
import { registerEvents } from "./routes/events"
import { registerFiles } from "./routes/files"
import { registerHousehold } from "./routes/household"
import { registerMessages } from "./routes/messages"
import { registerReminders } from "./routes/reminders"
import { registerSpeech } from "./routes/speech"

export type AppEnv = {
  Bindings: Env
  Variables: {
    traceId: string
    cookies: Record<string, string>
  }
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; frame-ancestors 'none'"
const LANDING = `<!doctype html>
<html lang="pt-PT">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgenteTobias</title>
<p>Abre a app AgenteTobias.</p>
`

function withSecurityHeaders(response: Response, traceId: string): Response {
  const headers = new Headers(response.headers)
  headers.set("x-trace-id", traceId)
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "no-referrer")
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export const app = new Hono<AppEnv>()

app.use("*", async (c, next) => {
  const traceId = crypto.randomUUID()
  c.set("traceId", traceId)
  c.set("cookies", getCookie(c))
  await next()
  c.res = withSecurityHeaders(c.res, traceId)
})

app.onError((err, c) => {
  console.error(JSON.stringify({ trace_id: c.get("traceId"), error: err.name }))
  return c.json(
    { error: { code: "unavailable", message: "Falhou. Tenta outra vez." } },
    500,
  )
})

registerAuth(app)
registerHousehold(app)
registerMessages(app)
registerEvents(app)
registerReminders(app)
registerSpeech(app)
registerFiles(app)

app.get("/", (c) => c.html(LANDING))

app.get("/.well-known/apple-app-site-association", (c) => {
  const team = c.env.APNS_TEAM_ID?.trim() ?? ""
  const bundle = c.env.APNS_BUNDLE_ID?.trim() || "br.com.timdevops.tobias"
  const apps = team ? [`${team}.${bundle}`] : []
  return c.json({ webcredentials: { apps } })
})

app.notFound((c) => {
  return c.json({ error: { code: "not_found", message: "Não encontrado." } }, 404)
})
