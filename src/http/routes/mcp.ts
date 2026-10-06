import { handleRpc, type RpcResult } from "../../application/mcp/rpc"
import { sessionFromToken } from "../../application/mcp/tokens"
import type { Env } from "../../env"
import type { Context } from "hono"
import type { Hono } from "hono"

type McpEnv = { Bindings: Env }

export function registerMcp<E extends McpEnv>(app: Hono<E>): void {
  app.post("/mcp", (c) => mcp(c))
  app.get("/mcp", (c) => c.json({ error: { code: "method_not_allowed", message: "Usa POST." } }, 405))
}

async function mcp<E extends McpEnv>(c: Context<E>) {
  const pepper = c.env.PIN_PEPPER
  const header = c.req.header("Authorization") ?? ""
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : ""
  if (!pepper || !token) return c.body(null, 401)
  const session = await sessionFromToken(c.env.DB, token, pepper)
  if (!session) return c.body(null, 401)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400)
  }

  const now = new Date()
  if (Array.isArray(body)) {
    const replies: Record<string, unknown>[] = []
    for (const item of body) {
      const result = await one(c.env, session, item, now)
      if (result.kind === "reply") replies.push(result.body)
    }
    if (replies.length === 0) return c.body(null, 202)
    return c.json(replies)
  }

  const result = await one(c.env, session, body, now)
  if (result.kind === "none") return c.body(null, 202)
  return c.json(result.body)
}

async function one(env: Env, session: Awaited<ReturnType<typeof sessionFromToken>>, item: unknown, now: Date): Promise<RpcResult> {
  if (!session) return { kind: "reply", body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } } }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return { kind: "reply", body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } } }
  }
  return handleRpc(env, session, item as { id?: string | number | null; method?: string; params?: unknown }, now)
}
