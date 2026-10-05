import { bytesToHex, hexToBytes, timingSafeEqual } from "./codec"

/** Pelo menos 100 000, como o requisito. O plano Free pode obrigar a baixar para 20 000 num ADR. */
export const PIN_ITERATIONS = 100_000

const WINDOW_MS = 10 * 60 * 1000
const MAX_FAILURES = 5
const failures = new Map<string, number[]>()

const DUMMY_HASH =
  "pbkdf2-sha256$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000"

export function isPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{4,6}$/.test(value)
}

export async function hashPin(pin: string, pepper: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await derive(pin, pepper, salt, PIN_ITERATIONS)
  return `pbkdf2-sha256$${PIN_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`
}

export async function verifyPin(pin: string, pepper: string, stored: string | null): Promise<boolean> {
  const parsed = parseStored(stored ?? DUMMY_HASH)
  if (!parsed) return false
  const actual = await derive(pin, pepper, parsed.salt, parsed.iterations)
  const matches = timingSafeEqual(actual, parsed.hash)
  return Boolean(stored) && matches
}

export function pinLocked(deviceId: string, now: Date): boolean {
  return recent(deviceId, now).length >= MAX_FAILURES
}

export function recordPinFailure(deviceId: string, now: Date): void {
  const stamps = recent(deviceId, now)
  stamps.push(now.getTime())
  failures.set(deviceId, stamps)
}

export function clearPinFailures(deviceId: string): void {
  failures.delete(deviceId)
}

function recent(deviceId: string, now: Date): number[] {
  const cutoff = now.getTime() - WINDOW_MS
  const stamps = (failures.get(deviceId) ?? []).filter((stamp) => stamp > cutoff)
  failures.set(deviceId, stamps)
  return stamps
}

function parseStored(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const [algorithm, rounds, saltHex, hashHex] = stored.split("$")
  if (algorithm !== "pbkdf2-sha256" || !rounds || !saltHex || !hashHex) return null
  const iterations = Number(rounds)
  if (!Number.isInteger(iterations) || iterations < 20_000 || iterations > PIN_ITERATIONS) return null
  const salt = hexToBytes(saltHex)
  const hash = hexToBytes(hashHex)
  if (!salt || !hash || hash.length !== 32) return null
  return { iterations, salt, hash }
}

async function derive(pin: string, pepper: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${pepper}:${pin}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const saltCopy = new Uint8Array(salt)
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltCopy.buffer as ArrayBuffer, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}
