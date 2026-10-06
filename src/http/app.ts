import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import type { Env } from "../env"
import { registerAuth } from "./routes/auth"
import { registerHousehold } from "./routes/household"
import { registerMcp } from "./routes/mcp"
import { registerWeb } from "./routes/web"

export type AppEnv = {
  Bindings: Env
  Variables: {
    traceId: string
    cookies: Record<string, string>
  }
}

const CONTENT_SECURITY_POLICY = "default-src 'self'; frame-ancestors 'none'"

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
    { error: { code: "unavailable", message: "Falhou. Tente de novo." } },
    500,
  )
})

registerAuth(app)
registerHousehold(app)
registerWeb(app)
registerMcp(app)

app.notFound((c) => {
  return c.json({ error: { code: "not_found", message: "Não encontrado." } }, 404)
})
