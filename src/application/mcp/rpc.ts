import { executeTool } from "../agent/execute"
import { confirmMessage, type ProposalDraft } from "../agent/confirm"
import { saveResult } from "../agent/sql"
import { SYSTEM_PROMPT, renderCard, systemContent, toolDefinitions } from "../agent/context"
import { AgentError } from "../agent/errors"
import { loadHouseholdCard, toolMessage, type TurnMessage } from "./turn"
import type { Session } from "../../domain/types"
import type { Env } from "../../env"

class ParamsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ParamsError"
  }
}
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const CARD_URI = "tobias://household/card"
const PROMPT_NAME = "instrucoes"

type Rpc = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

export type RpcResult =
  | { kind: "none" }
  | { kind: "reply"; body: Record<string, unknown> }

export async function handleRpc(env: Env, session: Session, message: Rpc, now: Date): Promise<RpcResult> {
  if (!Object.hasOwn(message, "id")) return { kind: "none" }
  const id = message.id ?? null
  try {
    const result = await dispatch(env, session, message.method ?? "", message.params, now)
    if (result === undefined) return { kind: "reply", body: errorBody(id, -32601, "Method not found") }
    return { kind: "reply", body: { jsonrpc: "2.0", id, result } }
  } catch (error) {
    if (error instanceof ParamsError) return { kind: "reply", body: errorBody(id, -32602, error.message) }
    const name = error instanceof Error ? error.name : "Error"
    console.error(JSON.stringify({ error: name }))
    return { kind: "reply", body: errorBody(id, -32603, "Internal error") }
  }
}

async function dispatch(
  env: Env,
  session: Session,
  method: string,
  params: unknown,
  now: Date,
): Promise<unknown> {
  if (method === "initialize") return initialize(env, session, params)
  if (method === "ping") return {}
  if (method === "tools/list") return { tools: mcpTools() }
  if (method === "tools/call") return callTool(env, session, params, now)
  if (method === "prompts/list") {
    return {
      prompts: [{ name: PROMPT_NAME, description: "Instruções da memória da casa e o cartão actual." }],
    }
  }
  if (method === "prompts/get") return prompt(env, session, params)
  if (method === "resources/list") {
    return {
      resources: [
        {
          uri: CARD_URI,
          name: "Cartão da casa",
          description: "Membros e entidades activas.",
          mimeType: "text/plain",
        },
      ],
    }
  }
  if (method === "resources/read") return resource(env, session, params)
  return undefined
}

async function initialize(env: Env, session: Session, params: unknown): Promise<unknown> {
  const requested = params && typeof params === "object" ? (params as { protocolVersion?: unknown }).protocolVersion : undefined
  const protocolVersion =
    typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-03-26"
  const card = await loadHouseholdCard(env.DB, session)
  return {
    protocolVersion,
    capabilities: {
      tools: { listChanged: false },
      prompts: { listChanged: false },
      resources: { listChanged: false },
    },
    serverInfo: { name: "agentetobias", version: "1" },
    instructions: systemContent(card),
  }
}

function mcpTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return toolDefinitions().map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters,
  }))
}

async function callTool(env: Env, session: Session, params: unknown, now: Date): Promise<unknown> {
  const name = params && typeof params === "object" ? (params as { name?: unknown }).name : undefined
  if (typeof name !== "string" || !name) {
    return toolError("Missing tool name.")
  }
  const args = readArguments(params)
  if (name === "remember" || name === "amend") {
    const pendingId = await matchingProposal(env.DB, session, args)
    if (pendingId) {
      try {
        const confirmed = await confirmMessage(env, session, pendingId, true)
        return { content: [{ type: "text", text: JSON.stringify({ saved: confirmed.events, reply: confirmed.reply }) }] }
      } catch (error) {
        if (error instanceof AgentError) return toolError(error.message)
        throw error
      }
    }
  }
  const text = argumentText(args) || name
  const message: TurnMessage =
    name === "remember" || name === "amend" ? await toolMessage(env.DB, session, text, now) : blankMessage(text)
  const outcome = await executeTool(env, session, message, { name, arguments: args }, now)
  if (outcome.kind === "proposal") {
    const body = {
      messageId: message.id,
      conversationId: message.conversationId,
      status: "proposal" as const,
      reply: outcome.reply,
      events: [],
      idempotent: false,
      draft: outcome.draft,
    }
    await saveResult(env.DB, session.householdId, message.id, "interpreted", JSON.stringify(body))
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            needs_confirmation: true,
            reply: outcome.reply,
            message: "Not saved. Ask the person. If they agree, call the same tool again with the same arguments.",
          }),
        },
      ],
    }
  }
  const failed = typeof outcome.payload.error === "string"
  return {
    content: [{ type: "text", text: JSON.stringify(outcome.payload) }],
    ...(failed ? { isError: true } : {}),
  }
}

async function prompt(env: Env, session: Session, params: unknown): Promise<unknown> {
  const name = params && typeof params === "object" ? (params as { name?: unknown }).name : undefined
  if (name !== PROMPT_NAME) throw new ParamsError("Unknown prompt")
  const card = await loadHouseholdCard(env.DB, session)
  return {
    description: "Instruções da memória da casa.",
    messages: [{ role: "user", content: { type: "text", text: `${SYSTEM_PROMPT}\n\n${renderCard(card)}` } }],
  }
}

async function resource(env: Env, session: Session, params: unknown): Promise<unknown> {
  const uri = params && typeof params === "object" ? (params as { uri?: unknown }).uri : undefined
  if (uri !== CARD_URI) throw new ParamsError("Unknown resource")
  const card = await loadHouseholdCard(env.DB, session)
  return {
    contents: [{ uri: CARD_URI, mimeType: "text/plain", text: renderCard(card) }],
  }
}

function readArguments(params: unknown): unknown {
  if (!params || typeof params !== "object") return {}
  const value = (params as { arguments?: unknown }).arguments
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return {}
    }
  }
  return value ?? {}
}

function argumentText(args: unknown): string {
  if (!args || typeof args !== "object") return ""
  const text = (args as { text?: unknown }).text
  return typeof text === "string" ? text.trim().slice(0, 500) : ""
}

async function matchingProposal(db: D1Database, session: Session, args: unknown): Promise<string | null> {
  const listed = await db
    .prepare(
      `SELECT id, result_json FROM messages
       WHERE household_id = ? AND actor_id = ? AND result_json IS NOT NULL
       ORDER BY created_at DESC LIMIT 8`,
    )
    .bind(session.householdId, session.userId)
    .all<{ id: string; result_json: string }>()
  for (const row of listed.results ?? []) {
    const draft = proposalDraft(row.result_json)
    if (draft && sameFact(args, draft)) return row.id
  }
  return null
}

function proposalDraft(json: string): ProposalDraft | null {
  try {
    const body = JSON.parse(json) as { status?: unknown; draft?: ProposalDraft }
    if (body.status !== "proposal" || !body.draft || body.draft.kind !== "event") return null
    return body.draft
  } catch {
    return null
  }
}

function sameFact(args: unknown, draft: ProposalDraft): boolean {
  if (!args || typeof args !== "object") return false
  const input = args as { text?: unknown; type?: unknown; amountMinor?: unknown }
  let data: { text?: unknown }
  try {
    data = JSON.parse(draft.dataJson) as { text?: unknown }
  } catch {
    return false
  }
  if (typeof input.text !== "string" || input.text.trim() !== data.text) return false
  if (typeof input.type === "string" && input.type !== draft.type) return false
  if (draft.amountMinor == null) return input.amountMinor == null
  return input.amountMinor === draft.amountMinor
}

function blankMessage(text: string): TurnMessage {
  const id = crypto.randomUUID()
  return { id, text, conversationId: id }
}

function toolError(message: string): unknown {
  return { content: [{ type: "text", text: JSON.stringify({ error: "validation", message }) }], isError: true }
}

function errorBody(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } }
}
