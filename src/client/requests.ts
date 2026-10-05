import { startAuthentication, startRegistration } from "@simplewebauthn/browser"
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser"
import { removeMessage, putMessage } from "./outbox"
import type { OutboxMessage } from "./outbox"
import type { EventSummary, Me, MessageResponse, Reminder } from "./types"

export type SendResult =
  | { kind: "ok"; response: MessageResponse }
  | { kind: "queued" }
  | { kind: "unauthorized"; message: string | null }
  | { kind: "error"; message: string | null }

export type SettledMessage = {
  clientMessageId: string
  text: string
  queuedAt: number
  response: MessageResponse | null
  error: string | null
}

const settled = new Map<string, SettledMessage>()

export function settledMessages(): SettledMessage[] {
  return Array.from(settled.values())
}

function remember(input: OutboxMessage, response: MessageResponse | null, error: string | null) {
  settled.set(input.clientMessageId, {
    clientMessageId: input.clientMessageId,
    text: input.text,
    queuedAt: input.queuedAt,
    response,
    error,
  })
}

async function errorMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== "object" || !("error" in body)) return null
    const error = (body as { error: unknown }).error
    if (!error || typeof error !== "object" || !("message" in error)) return null
    const message = (error as { message: unknown }).message
    return typeof message === "string" ? message : null
  } catch {
    return null
  }
}

function isOptions(value: unknown): value is PublicKeyCredentialRequestOptionsJSON {
  return Boolean(value && typeof value === "object" && "challenge" in value && typeof (value as { challenge: unknown }).challenge === "string")
}

function authenticationOptions(value: unknown): PublicKeyCredentialRequestOptionsJSON | null {
  if (isOptions(value)) return value
  if (value && typeof value === "object" && "options" in value && isOptions((value as { options: unknown }).options)) {
    return (value as { options: PublicKeyCredentialRequestOptionsJSON }).options
  }
  return null
}

function isEvent(value: unknown): value is EventSummary {
  return Boolean(value && typeof value === "object" && typeof (value as EventSummary).id === "string")
}

function parseMessage(value: unknown): MessageResponse | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (typeof row.reply !== "string" || typeof row.conversationId !== "string") return null
  if (
    row.status !== "interpreted" &&
    row.status !== "stored" &&
    row.status !== "clarification" &&
    row.status !== "proposal"
  ) {
    return null
  }
  let clarification: { question: string } | null = null
  if (row.clarification && typeof row.clarification === "object" && "question" in row.clarification) {
    const question = (row.clarification as { question: unknown }).question
    if (typeof question === "string") clarification = { question }
  }
  return {
    messageId: typeof row.messageId === "string" ? row.messageId : "",
    conversationId: row.conversationId,
    status: row.status,
    reply: row.reply,
    events: Array.isArray(row.events) ? row.events.filter(isEvent) : [],
    clarification,
    idempotent: row.idempotent === true,
  }
}

function messageBody(input: OutboxMessage): Record<string, string> {
  const body: Record<string, string> = {
    clientMessageId: input.clientMessageId,
    text: input.text,
  }
  if (input.conversationId) body.conversationId = input.conversationId
  if (input.correctsEventId) body.correctsEventId = input.correctsEventId
  return body
}

export async function fetchMe(): Promise<
  | { kind: "in"; me: Me }
  | { kind: "out" }
  | { kind: "error"; message: string | null }
> {
  try {
    const response = await fetch("/api/me", { credentials: "include" })
    if (response.status === 401) return { kind: "out" }
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const body: unknown = await response.json()
    if (!body || typeof body !== "object") return { kind: "error", message: null }
    const me = body as Me
    if (!me.user || typeof me.user.displayName !== "string" || !me.household) {
      return { kind: "error", message: null }
    }
    return { kind: "in", me }
  } catch {
    return { kind: "error", message: null }
  }
}

export async function loginWithPasskey(): Promise<
  | { kind: "ok" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string | null }
> {
  let optionsResponse: Response
  try {
    optionsResponse = await fetch("/api/auth/login/options", {
      method: "POST",
      credentials: "include",
    })
  } catch {
    return { kind: "error", message: null }
  }
  if (!optionsResponse.ok) return { kind: "error", message: await errorMessage(optionsResponse) }

  const optionsJSON = authenticationOptions(await optionsResponse.json())
  if (!optionsJSON) return { kind: "error", message: null }

  try {
    const assertion = await startAuthentication({ optionsJSON })
    const loginResponse = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(assertion),
    })
    if (!loginResponse.ok) return { kind: "error", message: await errorMessage(loginResponse) }
    return { kind: "ok" }
  } catch (err) {
    if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
      return { kind: "cancelled" }
    }
    return { kind: "error", message: null }
  }
}

export type Member = { id: string; displayName: string; role: "owner" | "adult" | "member" | "child" }
export type Vehicle = { id: string; name: string }

export async function fetchSetup(): Promise<{ needsBootstrap: boolean } | null> {
  try {
    const response = await fetch("/api/setup")
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (!body || typeof body !== "object" || typeof (body as { needsBootstrap?: unknown }).needsBootstrap !== "boolean") {
      return null
    }
    return { needsBootstrap: (body as { needsBootstrap: boolean }).needsBootstrap }
  } catch {
    return null
  }
}

async function finishPasskey(options: unknown): Promise<{ kind: "ok" } | { kind: "cancelled" } | { kind: "error"; message: string | null }> {
  const optionsJSON = registrationOptions(options)
  if (!optionsJSON) return { kind: "error", message: null }
  try {
    const credential = await startRegistration({ optionsJSON })
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    })
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    return { kind: "ok" }
  } catch (err) {
    if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
      return { kind: "cancelled" }
    }
    return { kind: "error", message: null }
  }
}

export async function bootstrapHouse(input: {
  token: string
  displayName: string
  householdName: string
}): Promise<{ kind: "ok" } | { kind: "cancelled" } | { kind: "error"; message: string | null }> {
  try {
    const response = await fetch("/api/bootstrap", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const body: unknown = await response.json()
    const options = body && typeof body === "object" && "options" in body ? (body as { options: unknown }).options : null
    return finishPasskey(options)
  } catch {
    return { kind: "error", message: null }
  }
}

export async function joinWithInvite(input: {
  inviteCode: string
  displayName: string
}): Promise<{ kind: "ok" } | { kind: "cancelled" } | { kind: "error"; message: string | null }> {
  try {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const body: unknown = await response.json()
    const options = body && typeof body === "object" && "options" in body ? (body as { options: unknown }).options : null
    return finishPasskey(options)
  } catch {
    return { kind: "error", message: null }
  }
}

export async function fetchHousehold(): Promise<
  | { kind: "ok"; members: Member[]; vehicles: Vehicle[] }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string | null }
> {
  try {
    const response = await fetch("/api/household", { credentials: "include" })
    if (response.status === 401) return { kind: "unauthorized" }
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const body: unknown = await response.json()
    if (!body || typeof body !== "object") return { kind: "error", message: null }
    const row = body as { members?: unknown; vehicles?: unknown }
    const members = Array.isArray(row.members) ? row.members.filter(isMember) : []
    const vehicles = Array.isArray(row.vehicles) ? row.vehicles.filter(isVehicle) : []
    return { kind: "ok", members, vehicles }
  } catch {
    return { kind: "error", message: null }
  }
}

export async function addMember(input: {
  displayName: string
  role: "adult" | "member" | "child"
}): Promise<{ kind: "ok"; code: string } | { kind: "unauthorized" } | { kind: "error"; message: string | null }> {
  return postJson("/api/household/members", input, (body) => {
    if (!body || typeof body !== "object" || typeof (body as { code?: unknown }).code !== "string") return null
    return { kind: "ok", code: (body as { code: string }).code }
  })
}

export async function addVehicle(input: {
  name: string
  alias: string
}): Promise<{ kind: "ok" } | { kind: "unauthorized" } | { kind: "error"; message: string | null }> {
  return postJson("/api/household/vehicles", input, () => ({ kind: "ok" }))
}

function isMember(value: unknown): value is Member {
  if (!value || typeof value !== "object") return false
  const row = value as Member
  return typeof row.id === "string" && typeof row.displayName === "string" && typeof row.role === "string"
}

function isVehicle(value: unknown): value is Vehicle {
  if (!value || typeof value !== "object") return false
  const row = value as Vehicle
  return typeof row.id === "string" && typeof row.name === "string"
}

function registrationOptions(value: unknown): PublicKeyCredentialCreationOptionsJSON | null {
  if (value && typeof value === "object" && "challenge" in value) {
    return value as PublicKeyCredentialCreationOptionsJSON
  }
  return null
}

async function postJson<T extends { kind: "ok" }>(
  path: string,
  body: unknown,
  ok: (body: unknown) => T | null,
): Promise<T | { kind: "unauthorized" } | { kind: "error"; message: string | null }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (response.status === 401) return { kind: "unauthorized" }
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const parsed = ok(await response.json())
    if (!parsed) return { kind: "error", message: null }
    return parsed
  } catch {
    return { kind: "error", message: null }
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
  } catch {
    // The screen still leaves. The cookie expires on its own if the call never left.
  }
}

export async function postMessage(input: OutboxMessage): Promise<SendResult> {
  if (!navigator.onLine) {
    await putMessage(input)
    return { kind: "queued" }
  }

  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messageBody(input)),
    })
    if (response.status === 401) {
      return { kind: "unauthorized", message: await errorMessage(response) }
    }
    if (!response.ok) {
      const message = await errorMessage(response)
      await removeMessage(input.clientMessageId)
      remember(input, null, message)
      return { kind: "error", message }
    }
    const parsed = parseMessage(await response.json())
    if (!parsed) {
      await removeMessage(input.clientMessageId)
      remember(input, null, null)
      return { kind: "error", message: null }
    }
    await removeMessage(input.clientMessageId)
    remember(input, parsed, null)
    return { kind: "ok", response: parsed }
  } catch {
    await putMessage(input)
    return { kind: "queued" }
  }
}

export async function postSpeech(
  audio: Blob,
  mime: string,
): Promise<
  | { kind: "ok"; transcript: string }
  | { kind: "unavailable" }
  | { kind: "unauthorized"; message: string | null }
  | { kind: "error"; message: string | null }
> {
  const form = new FormData()
  const filename = mime.includes("mp4") ? "audio.mp4" : "audio.webm"
  form.append("audio", new File([audio], filename, { type: mime }))
  form.append("clientMessageId", crypto.randomUUID())

  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      credentials: "include",
      body: form,
    })
    if (response.status === 503) return { kind: "unavailable" }
    if (response.status === 401) {
      return { kind: "unauthorized", message: await errorMessage(response) }
    }
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const body: unknown = await response.json()
    if (!body || typeof body !== "object" || typeof (body as { transcript?: unknown }).transcript !== "string") {
      return { kind: "error", message: null }
    }
    return { kind: "ok", transcript: (body as { transcript: string }).transcript }
  } catch {
    return { kind: "unavailable" }
  }
}

export async function fetchReminders(): Promise<
  | { kind: "ok"; reminders: Reminder[] }
  | { kind: "unauthorized"; message: string | null }
  | { kind: "error"; message: string | null }
> {
  try {
    const response = await fetch("/api/reminders?status=open", { credentials: "include" })
    if (response.status === 401) return { kind: "unauthorized", message: await errorMessage(response) }
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    const body: unknown = await response.json()
    const rows = body && typeof body === "object" && Array.isArray((body as { reminders?: unknown }).reminders)
      ? (body as { reminders: Reminder[] }).reminders
      : []
    return { kind: "ok", reminders: rows }
  } catch {
    return { kind: "error", message: null }
  }
}

export async function postConfirm(
  messageId: string,
  accept: boolean,
): Promise<{ kind: "ok"; response: MessageResponse } | { kind: "unauthorized" } | { kind: "error"; message: string | null }> {
  return postJson(`/api/messages/${encodeURIComponent(messageId)}/confirm`, { accept }, (body) => {
    const response = parseMessage(body)
    return response ? { kind: "ok", response } : null
  })
}

export async function voidEvent(id: string): Promise<
  | { kind: "ok" }
  | { kind: "unauthorized"; message: string | null }
  | { kind: "error"; message: string | null }
> {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(id)}/void`, {
      method: "POST",
      credentials: "include",
    })
    if (response.status === 401) return { kind: "unauthorized", message: await errorMessage(response) }
    if (!response.ok) return { kind: "error", message: await errorMessage(response) }
    return { kind: "ok" }
  } catch {
    return { kind: "error", message: null }
  }
}
