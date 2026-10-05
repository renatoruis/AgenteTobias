/**
 * Eval do modelo. Fora do `npm test`.
 * Corre quando o prompt, as tools ou o modelo mudam, com rede:
 *
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npx vitest run --config tests/evals/vitest.config.ts
 *
 * Opcionais: AI_INTERPRET_MODEL (default openai/gpt-5-mini), AI_GATEWAY_ID (default agentetobias).
 * Para comparar o fallback: AI_INTERPRET_MODEL=google-ai-studio/gemini-2.5-flash-lite.
 *
 * Usa o mesmo SYSTEM_PROMPT, cartão da casa e tools do Worker, pelo endpoint compat
 * do AI Gateway com Unified Billing. Só olha para a primeira resposta do modelo:
 * que tool chamou e com que argumentos, ou que texto escreveu.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { renderCard, SYSTEM_PROMPT, toolDefinitions, userContent, type HouseholdCard } from "../../src/application/agent/context"

type FixtureEntity = { kind: string; name: string }

type Expectation = {
  /** Tool the first response must call. `null` means a text reply without tools. */
  tool: string | null
  type?: string | string[]
  amountMinor?: number
  entityNames?: string[]
  warrantyMonths?: number
  /** Accept, instead of `tool`, a text reply that names every item here (a question such as "o i30 ou o Aveo?"). */
  orQuestionMentioning?: string[]
}

type Phrase = { input: string; fixture: FixtureEntity[]; expect: Expectation }

type ToolCall = { name: string; arguments: Record<string, unknown> }
type FirstReply = { text: string | null; calls: ToolCall[] }

const MODEL = process.env.AI_INTERPRET_MODEL ?? "openai/gpt-5-mini"
const GATEWAY_ID = process.env.AI_GATEWAY_ID ?? "agentetobias"
const NOW = new Date("2026-10-05T12:00:00.000Z")

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ")
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return asRecord(value)
}

function firstReply(body: unknown): FirstReply {
  const choices = asRecord(body).choices
  const message = asRecord(asRecord(Array.isArray(choices) ? choices[0] : undefined).message)
  const raw = Array.isArray(message.tool_calls) ? message.tool_calls : []
  return {
    text: typeof message.content === "string" && message.content.trim() !== "" ? message.content : null,
    calls: raw.map((item) => {
      const call = asRecord(item)
      const fn = asRecord(call.function)
      return { name: String(fn.name ?? call.name ?? ""), arguments: parseArguments(fn.arguments ?? call.arguments) }
    }),
  }
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  return null
}

function namesOf(call: ToolCall): string[] {
  const out: string[] = []
  if (Array.isArray(call.arguments.entities)) {
    for (const entry of call.arguments.entities) {
      const name = asRecord(entry).name
      if (typeof name === "string") out.push(name)
    }
  }
  if (typeof call.arguments.entity === "string") out.push(call.arguments.entity)
  if (typeof call.arguments.place === "string") out.push(call.arguments.place)
  const product = asRecord(call.arguments.details).product
  if (typeof product === "string") out.push(product)
  return out
}

function diffsFor(phrase: Phrase, reply: FirstReply): string[] {
  const expected = phrase.expect
  const diffs: string[] = []
  const names = reply.calls.map((call) => call.name)

  if (expected.orQuestionMentioning && reply.calls.length === 0 && reply.text) {
    const text = normalize(reply.text)
    const missing = expected.orQuestionMentioning.filter((name) => !text.includes(normalize(name)))
    if (missing.length === 0) return []
    return [`pergunta sem ${missing.join(", ")}: ${reply.text}`]
  }

  if (expected.tool === null) {
    if (names.length > 0) diffs.push(`tool: esperado nenhuma, veio ${names.join(", ")}`)
    if (!reply.text) diffs.push("texto: esperado uma resposta, veio vazio")
    return diffs
  }

  const primary = reply.calls.find((call) => call.name === expected.tool)
  if (!primary) {
    diffs.push(`tool: esperado ${expected.tool}, veio ${names.join(", ") || `texto «${reply.text ?? ""}»`}`)
    return diffs
  }
  if (expected.tool !== "remember" && names.includes("remember")) diffs.push("remember: não devia gravar")

  if (expected.type != null) {
    const allowed = Array.isArray(expected.type) ? expected.type : [expected.type]
    const type = typeof primary.arguments.type === "string" ? primary.arguments.type : null
    if (type == null || !allowed.includes(type)) diffs.push(`type: esperado ${allowed.join(" ou ")}, veio ${type ?? "nenhum"}`)
  }
  if (typeof expected.amountMinor === "number") {
    const amount = numberOf(primary.arguments.amountMinor)
    if (amount !== expected.amountMinor) diffs.push(`amountMinor: esperado ${expected.amountMinor}, veio ${amount ?? "nenhum"}`)
  }
  if (typeof expected.warrantyMonths === "number") {
    const months = numberOf(primary.arguments.warrantyMonths)
    if (months !== expected.warrantyMonths) diffs.push(`warrantyMonths: esperado ${expected.warrantyMonths}, veio ${months ?? "nenhum"}`)
  }
  const actualNames = namesOf(primary).map(normalize)
  for (const name of expected.entityNames ?? []) {
    if (!actualNames.some((actual) => actual.includes(normalize(name)))) diffs.push(`entityNames: falta ${name}`)
  }
  return diffs
}

function loadPhrases(): Phrase[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), "phrases.json")
  return JSON.parse(readFileSync(path, "utf8")) as Phrase[]
}

function cardFor(fixture: FixtureEntity[]): HouseholdCard {
  return {
    name: "Casa",
    members: [
      { name: "Renato", role: "owner" },
      { name: "Renata", role: "adult" },
    ],
    entities: fixture.map((entity) => ({ name: entity.name, kind: entity.kind })),
  }
}

async function interpret(phrase: Phrase): Promise<unknown> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token) throw new Error("Faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN")

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "cf-aig-gateway-id": GATEWAY_ID,
      "cf-aig-skip-cache": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${renderCard(cardFor(phrase.fixture))}` },
        { role: "user", content: userContent({ name: "Renato", role: "owner" }, [], NOW, phrase.input) },
      ],
      tools: toolDefinitions(),
      tool_choice: "auto",
    }),
  })
  const body: unknown = await response.json()
  if (!response.ok) throw new Error(`modelo respondeu ${response.status}: ${JSON.stringify(body)}`)
  return body
}

describe(`eval ${MODEL}`, () => {
  for (const phrase of loadPhrases()) {
    it(phrase.input, async () => {
      const body = await interpret(phrase)
      const reply = firstReply(body)
      const diffs = diffsFor(phrase, reply)
      if (diffs.length > 0) console.log(`diff  ${phrase.input}\n  ${diffs.join("\n  ")}`)
      expect(diffs).toEqual([])
    })
  }
})
