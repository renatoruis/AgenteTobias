import { clockQuestion, clockReply } from "../../domain/dates"
import { confirmPhrase, replyFor, storedReply } from "../../domain/reply"
import type { EventSummary, MessageResponse, Session } from "../../domain/types"
import type { Env } from "../../env"
import { dbFrom } from "../../infrastructure/d1/client"
import { insertMessage } from "../../infrastructure/d1/queries"
import { confirmMessage, type ProposalDraft } from "./confirm"
import {
  historyMessages,
  MAX_ITERATIONS,
  MODEL_TIMEOUT_MS,
  HISTORY_LIMIT,
  systemContent,
  TIME_ZONE,
  toolDefinitions,
  userContent,
  type ChatMessage,
  type ChatToolCall,
} from "./context"
import { AgentError } from "./errors"
import { executeTool } from "./execute"
import {
  drizzleDb,
  dropConversation,
  eventsForMessage,
  householdCard,
  openConversation,
  openProposal,
  recentTurns,
  requireCorrectable,
  saveResult,
  speakerName,
  todayEvents,
  toSummary,
  writeUsage,
} from "./sql"

export type MessageInput = {
  clientMessageId: string
  text: string
  conversationId?: string
  /** The Edit button: this sentence corrects that event. The model is told to use `amend`. */
  correctsEventId?: string
}

type ModelReply = {
  text: string | null
  calls: ChatToolCall[]
  tokensIn: number | null
  tokensOut: number | null
}

type Usage = {
  tool: string | null
  model: string
  errorCode: string | null
  latencyMs: number
  tokensIn: number | null
  tokensOut: number | null
}

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
    const first = already[0]!
    const response = interpreted(messageId, conversationId, replyFor(first), already.map(toSummary))
    await saveResult(env.DB, session.householdId, messageId, "interpreted", JSON.stringify(response))
    return { ...response, idempotent: true }
  }

  const clock = clockQuestion(text)
  if (clock) {
    return commit(env, session, messageId, conversationId, interpreted(messageId, conversationId, clockReply(clock, now, TIME_ZONE), []), null)
  }

  const pending = await openProposal(env.DB, session.householdId, conversationId)
  if (pending && pending.id !== messageId) {
    const decision = confirmPhrase(text)
    if (decision) {
      const settled = await confirmMessage(env, session, pending.id, decision === "yes")
      return commit(env, session, messageId, conversationId, { ...settled, messageId, conversationId, idempotent: false }, null)
    }
    await confirmMessage(env, session, pending.id, false)
  }

  const corrects = input.correctsEventId
    ? await requireCorrectable(env.DB, session, input.correctsEventId)
    : null

  const [card, speaker, today, turns] = await Promise.all([
    householdCard(env.DB, session),
    speakerName(env.DB, session),
    todayEvents(env.DB, session, now),
    recentTurns(env.DB, session, conversationId, messageId, HISTORY_LIMIT),
  ])

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent(card) },
    ...historyMessages(turns),
    {
      role: "user",
      content: userContent({ name: speaker, role: session.role }, today, now, text, corrects?.id ?? null),
    },
  ]

  const started = Date.now()
  const usage: Usage = {
    tool: null,
    model: env.AI_INTERPRET_MODEL,
    errorCode: null,
    latencyMs: 0,
    tokensIn: null,
    tokensOut: null,
  }
  const events: EventSummary[] = []
  let draft: ProposalDraft | undefined
  let finalText: string | null = null
  let proposalReply: string | null = null

  for (let iteration = 0; iteration < MAX_ITERATIONS && finalText === null && proposalReply === null; iteration++) {
    const reply = await askModel(env, messages, usage)
    if (!reply) {
      usage.latencyMs = Date.now() - started
      return commit(env, session, messageId, conversationId, stored(messageId, conversationId), usage)
    }

    if (reply.calls.length === 0) {
      finalText = reply.text?.trim() || null
      if (finalText === null) break
      continue
    }

    messages.push({ role: "assistant", content: reply.text, tool_calls: reply.calls })
    for (const call of reply.calls) {
      usage.tool ??= call.function.name
      const outcome = await executeTool(
        env,
        session,
        { id: messageId, text, conversationId },
        { name: call.function.name, arguments: parseArguments(call.function.arguments) },
        now,
      )
      if (outcome.kind === "proposal") {
        proposalReply = outcome.reply
        draft = outcome.draft
        break
      }
      events.push(...outcome.events)
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(outcome.payload) })
    }
  }

  usage.latencyMs = Date.now() - started

  if (proposalReply !== null && draft) {
    const response: MessageResponse = {
      messageId,
      conversationId,
      status: "proposal",
      reply: proposalReply,
      events: [],
      idempotent: false,
    }
    return commit(env, session, messageId, conversationId, response, usage, draft)
  }

  const reply = finalText ?? fallbackReply(events)
  return commit(env, session, messageId, conversationId, interpreted(messageId, conversationId, reply, events), usage)
}

/** Primary model, then one try on the fallback. Null when both fail. */
async function askModel(env: Env, messages: ChatMessage[], usage: Usage): Promise<ModelReply | null> {
  const candidates = [env.AI_INTERPRET_MODEL, env.AI_FALLBACK_MODEL].filter(
    (model): model is string => typeof model === "string" && model.trim() !== "",
  )
  for (const model of candidates) {
    try {
      const raw = await withTimeout(
        env.AI.run(
          model,
          {
            messages,
            tools: toolDefinitions(),
            tool_choice: "auto",
            ...providerOptions(model),
          },
          { gateway: { id: env.AI_GATEWAY_ID, skipCache: true, requestTimeoutMs: MODEL_TIMEOUT_MS } },
        ),
        MODEL_TIMEOUT_MS,
      )
      const reply = readReply(raw)
      usage.model = model
      usage.errorCode = null
      usage.tokensIn = add(usage.tokensIn, reply.tokensIn)
      usage.tokensOut = add(usage.tokensOut, reply.tokensOut)
      return reply
    } catch (error) {
      usage.errorCode = error instanceof Error && error.message === "timeout" ? "timeout" : "model_error"
    }
  }
  return null
}

function providerOptions(model: string): Record<string, unknown> {
  if (model.startsWith("openai/gpt-5")) return { reasoning_effort: "low" }
  return {}
}

function readReply(raw: unknown): ModelReply {
  const body = asRecord(typeof raw === "string" ? parseJson(raw) : raw)
  const choice = asRecord(asRecord(Array.isArray(body.choices) ? body.choices[0] : undefined).message)
  const message = Object.keys(choice).length > 0 ? choice : body
  const usage = asRecord(body.usage)
  return {
    text: typeof message.content === "string" ? message.content : typeof body.response === "string" ? body.response : null,
    calls: readCalls(message.tool_calls),
    tokensIn: readNumber(usage.prompt_tokens ?? usage.input_tokens),
    tokensOut: readNumber(usage.completion_tokens ?? usage.output_tokens),
  }
}

function readCalls(value: unknown): ChatToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: ChatToolCall[] = []
  for (const entry of value) {
    const call = asRecord(entry)
    const fn = asRecord(call.function)
    const name = typeof fn.name === "string" ? fn.name : typeof call.name === "string" ? call.name : ""
    if (!name) continue
    const args = fn.name ? fn.arguments : call.arguments
    calls.push({
      id: typeof call.id === "string" && call.id ? call.id : crypto.randomUUID(),
      type: "function",
      function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
    })
  }
  return calls
}

function parseArguments(value: string): unknown {
  return parseJson(value) ?? {}
}

function fallbackReply(events: EventSummary[]): string {
  const last = events[events.length - 1]
  return last ? replyFor(last) : "Feito."
}

function replay(json: string, messageId: string, conversationId: string): MessageResponse {
  const body = asRecord(parseJson(json))
  if (typeof body.reply !== "string" || typeof body.status !== "string") {
    return { ...stored(messageId, conversationId), idempotent: true }
  }
  return {
    messageId,
    conversationId,
    status: body.status === "stored" || body.status === "proposal" ? body.status : "interpreted",
    reply: body.reply,
    events: Array.isArray(body.events) ? (body.events as EventSummary[]) : [],
    idempotent: true,
  }
}

function stored(messageId: string, conversationId: string): MessageResponse {
  return { messageId, conversationId, status: "stored", reply: storedReply(), events: [], idempotent: false }
}

function interpreted(messageId: string, conversationId: string, reply: string, events: EventSummary[]): MessageResponse {
  return { messageId, conversationId, status: "interpreted", reply, events, idempotent: false }
}

async function commit(
  env: Env,
  session: Session,
  messageId: string,
  conversationId: string,
  response: MessageResponse,
  usage: Usage | null,
  draft?: ProposalDraft,
): Promise<MessageResponse> {
  const columnStatus = response.status === "stored" ? "stored" : "interpreted"
  const body = { ...response, messageId, conversationId, ...(draft ? { draft } : {}) }
  await saveResult(env.DB, session.householdId, messageId, columnStatus, JSON.stringify(body))
  if (usage) {
    await writeUsage(env.DB, {
      messageId,
      tool: usage.tool,
      model: usage.model,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      latencyMs: Math.max(0, Math.round(usage.latencyMs)),
      errorCode: usage.errorCode,
      createdAt: new Date().toISOString(),
    })
  }
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

function add(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return a + b
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null
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
