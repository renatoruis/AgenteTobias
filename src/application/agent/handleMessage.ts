import type { MessageResponse, Session } from "../../domain/types"
import { replyFor, storedReply } from "../../domain/reply"
import { isToolName } from "../../domain/tools"
import type { Env } from "../../env"
import { dbFrom } from "../../infrastructure/d1/client"
import { insertMessage } from "../../infrastructure/d1/queries"
import { AgentError } from "./errors"
import { executeTool } from "./execute"
import {
  ENTITY_LIMIT,
  HISTORY_LIMIT,
  MODEL_TIMEOUT_MS,
  SYSTEM_PROMPT,
  modelTools,
  userContent,
} from "./prompt"
import {
  activeAliases,
  drizzleDb,
  dropConversation,
  eventsForMessage,
  openConversation,
  recentTurns,
  requireCorrectable,
  saveResult,
  toSummary,
  writeUsage,
  type EntityHit,
} from "./sql"
import { normalizeAlias } from "../../domain/alias"

export type MessageInput = {
  clientMessageId: string
  text: string
  conversationId?: string
  correctsEventId?: string
}

const VEHICLE_WORDS = new Set(["carro", "i30", "abasteci"])

export async function handleMessage(
  env: Env,
  session: Session,
  input: MessageInput,
  now: Date,
): Promise<MessageResponse> {
  const text = input.text.trim()
  if (!input.clientMessageId || text.length === 0) {
    throw new AgentError(400, "validation", "Mensagem inválida.")
  }

  const conversation = await openConversation(env.DB, session, input.conversationId, now)
  const inserted = await insertMessage(dbFrom(drizzleDb(env.DB)), {
    id: crypto.randomUUID(),
    householdId: session.householdId,
    actorId: session.userId,
    conversationId: conversation.id,
    clientMessageId: input.clientMessageId,
    text,
    source: "text",
    status: "stored",
    createdAt: now.toISOString(),
  })

  if (conversation.created && inserted.message.conversationId !== conversation.id) {
    await dropConversation(env.DB, session.householdId, conversation.id)
  }

  const messageId = inserted.message.id
  const conversationId = inserted.message.conversationId

  if (inserted.message.resultJson) {
    return replay(inserted.message.resultJson, messageId, conversationId)
  }

  const already = await eventsForMessage(env.DB, session.householdId, messageId)
  if (already.length > 0) {
    const response: MessageResponse = {
      messageId,
      conversationId,
      status: "interpreted",
      reply: replyFor({
        type: already[0]!.type,
        amountMinor: already[0]!.amountMinor,
        currency: already[0]!.currency,
        entityName: already[0]!.entityName,
        warrantyEndsOn: already[0]!.warrantyEndsOn,
      }),
      events: already.map(toSummary),
      clarification: null,
      idempotent: true,
    }
    await saveResult(env.DB, session.householdId, messageId, "interpreted", JSON.stringify(response))
    return response
  }

  const corrects = input.correctsEventId
    ? await requireCorrectable(env.DB, session, input.correctsEventId)
    : null

  const aliases = await activeAliases(env.DB, session.householdId)
  const history = await recentTurns(env.DB, session, conversationId, messageId, HISTORY_LIMIT)
  const started = Date.now()
  let raw: unknown
  try {
    raw = await withTimeout(
      env.AI.run(
        env.AI_INTERPRET_MODEL,
        {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: userContent(session.role, pickEntities(aliases, text), history, text),
            },
          ],
          tools: modelTools(),
          tool_choice: "required",
          temperature: 0,
        },
        {
          gateway: {
            id: env.AI_GATEWAY_ID,
            skipCache: true,
            requestTimeoutMs: MODEL_TIMEOUT_MS,
          },
        },
      ),
      MODEL_TIMEOUT_MS,
    )
  } catch (error) {
    const code = error instanceof Error && error.message === "timeout" ? "timeout" : "model_error"
    return commit(env, session, messageId, conversationId, stored(messageId, conversationId), {
      tool: null,
      errorCode: code,
      latencyMs: Date.now() - started,
      tokensIn: null,
      tokensOut: null,
      now,
    })
  }

  const tokens = readTokens(raw)
  const latencyMs = Date.now() - started
  const calls = extractToolCalls(raw)
  let read: { response: MessageResponse; tool: string } | null = null

  for (const call of calls) {
    if (!isToolName(call.name)) {
      return commit(env, session, messageId, conversationId, stored(messageId, conversationId), {
        tool: null,
        errorCode: "invalid_tool",
        latencyMs,
        ...tokens,
        now,
      })
    }
    const outcome = await executeTool(
      env,
      session,
      { id: messageId, text, conversationId },
      call,
      now,
      corrects,
    )
    if (outcome.kind === "invalid") {
      return commit(env, session, messageId, conversationId, stored(messageId, conversationId), {
        tool: call.name,
        errorCode: "invalid_tool",
        latencyMs,
        ...tokens,
        now,
      })
    }
    if (outcome.terminal === "read") {
      read = { response: outcome.response, tool: call.name }
      continue
    }
    return commit(env, session, messageId, conversationId, outcome.response, {
      tool: call.name,
      errorCode: null,
      latencyMs,
      ...tokens,
      now,
    })
  }

  if (read) {
    return commit(env, session, messageId, conversationId, read.response, {
      tool: read.tool,
      errorCode: null,
      latencyMs,
      ...tokens,
      now,
    })
  }

  return commit(env, session, messageId, conversationId, stored(messageId, conversationId), {
    tool: null,
    errorCode: "invalid_tool",
    latencyMs,
    ...tokens,
    now,
  })
}

function pickEntities(aliases: EntityHit[], text: string): Array<{ id: string; name: string; kind: string }> {
  const folded = normalizeAlias(text)
  const words = new Set(folded.split(" "))
  const wantVehicles = [...VEHICLE_WORDS].some((word) => words.has(word))
  const chosen: EntityHit[] = []
  const seen = new Set<string>()

  const push = (entity: EntityHit) => {
    if (seen.has(entity.id) || chosen.length >= ENTITY_LIMIT) return
    seen.add(entity.id)
    chosen.push(entity)
  }

  if (wantVehicles) {
    for (const entity of aliases) {
      if (entity.kind === "vehicle") push(entity)
    }
  }
  for (const entity of aliases) {
    if (mentioned(entity.normalized, folded)) push(entity)
  }
  return chosen.map((entity) => ({ id: entity.id, name: entity.name, kind: entity.kind }))
}

function mentioned(alias: string, folded: string): boolean {
  if (alias.length < 2) return false
  let from = 0
  while (from < folded.length) {
    const index = folded.indexOf(alias, from)
    if (index < 0) return false
    const before = index === 0 || !/[a-z0-9]/.test(folded[index - 1] ?? "")
    const afterIndex = index + alias.length
    const after = afterIndex >= folded.length || !/[a-z0-9]/.test(folded[afterIndex] ?? "")
    if (before && after) return true
    from = index + 1
  }
  return false
}

function extractToolCalls(raw: unknown): Array<{ name: string; arguments: unknown }> {
  const body = asRecord(typeof raw === "string" ? parseJson(raw) : raw)
  const direct = readCalls(body.tool_calls)
  if (direct.length > 0) return direct

  const choices = Array.isArray(body.choices) ? body.choices : []
  const message = asRecord(asRecord(choices[0]).message)
  const nested = readCalls(message.tool_calls)
  if (nested.length > 0) return nested

  if (typeof body.type === "string" && body.occurredAt && body.visibility) {
    return [{ name: "record_event", arguments: body }]
  }
  if (typeof body.question === "string" && body.type == null) {
    return [{ name: "ask_clarification", arguments: body }]
  }
  if (typeof body.name === "string") {
    return [{ name: body.name, arguments: body.arguments ?? body }]
  }
  return []
}

function readCalls(value: unknown): Array<{ name: string; arguments: unknown }> {
  if (!Array.isArray(value)) return []
  const calls: Array<{ name: string; arguments: unknown }> = []
  for (const entry of value) {
    const call = asRecord(entry)
    const fn = asRecord(call.function)
    const name = typeof fn.name === "string" ? fn.name : typeof call.name === "string" ? call.name : ""
    if (!name) continue
    const args = fn.name ? fn.arguments : call.arguments
    calls.push({ name, arguments: typeof args === "string" ? (parseJson(args) ?? {}) : (args ?? {}) })
  }
  return calls
}

function readTokens(raw: unknown): { tokensIn: number | null; tokensOut: number | null } {
  const usage = asRecord(asRecord(raw).usage)
  const input = usage.prompt_tokens ?? usage.input_tokens
  const output = usage.completion_tokens ?? usage.output_tokens
  return {
    tokensIn: typeof input === "number" ? Math.round(input) : null,
    tokensOut: typeof output === "number" ? Math.round(output) : null,
  }
}

function replay(json: string, messageId: string, conversationId: string): MessageResponse {
  const parsed = parseJson(json)
  const body = asRecord(parsed)
  if (typeof body.reply !== "string" || typeof body.status !== "string") {
    return { ...stored(messageId, conversationId), idempotent: true }
  }
  return {
    messageId: typeof body.messageId === "string" ? body.messageId : messageId,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : conversationId,
    status: body.status === "clarification" || body.status === "stored" ? body.status : "interpreted",
    reply: body.reply,
    events: Array.isArray(body.events) ? (body.events as MessageResponse["events"]) : [],
    clarification:
      body.clarification && typeof asRecord(body.clarification).question === "string"
        ? { question: String(asRecord(body.clarification).question) }
        : null,
    idempotent: true,
  }
}

function stored(messageId: string, conversationId: string): MessageResponse {
  return {
    messageId,
    conversationId,
    status: "stored",
    reply: storedReply(),
    events: [],
    clarification: null,
    idempotent: false,
  }
}

async function commit(
  env: Env,
  session: Session,
  messageId: string,
  conversationId: string,
  response: MessageResponse,
  usage: {
    tool: string | null
    errorCode: string | null
    latencyMs: number
    tokensIn: number | null
    tokensOut: number | null
    now: Date
  },
): Promise<MessageResponse> {
  const columnStatus = response.status === "stored" ? "stored" : "interpreted"
  await saveResult(
    env.DB,
    session.householdId,
    messageId,
    columnStatus,
    JSON.stringify({ ...response, messageId, conversationId }),
  )
  await writeUsage(env.DB, {
    messageId,
    tool: usage.tool,
    model: env.AI_INTERPRET_MODEL,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: Math.max(0, Math.round(usage.latencyMs)),
    errorCode: usage.errorCode,
    createdAt: usage.now.toISOString(),
  })
  return { ...response, messageId, conversationId }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms)
  })
  promise.then(
    () => undefined,
    () => undefined,
  )
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
