import type { Env } from "../env"

export type ApnsAlert = {
  token: string
  environment: "sandbox" | "production"
  title: string
  body: string
  reminderId: string
  sound: boolean
  badge: number | null
}

export type ApnsResult = "sent" | "gone" | "failed" | "unconfigured"

type CachedJwt = { token: string; until: number; keyId: string }

let cachedJwt: CachedJwt | null = null

export function apnsConfigured(env: Env): boolean {
  return Boolean(env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_AUTH_KEY && env.APNS_BUNDLE_ID)
}

export async function sendAlert(env: Env, alert: ApnsAlert): Promise<ApnsResult> {
  if (!apnsConfigured(env)) return "unconfigured"
  const jwt = await providerToken(env)
  if (!jwt) return "failed"
  const host = alert.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com"
  const aps: Record<string, unknown> = {
    alert: { title: alert.title, body: alert.body },
    category: "REMINDER",
  }
  if (alert.sound) aps.sound = "default"
  if (alert.badge !== null) aps.badge = alert.badge
  const response = await fetch(`https://${host}/3/device/${alert.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": env.APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: JSON.stringify({ aps, reminderId: alert.reminderId }),
  })
  if (response.ok) return "sent"
  const reason = await apnsReason(response)
  if (response.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") return "gone"
  return "failed"
}

async function apnsReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { reason?: unknown }
    return typeof body.reason === "string" ? body.reason : ""
  } catch {
    return ""
  }
}

async function providerToken(env: Env): Promise<string | null> {
  const keyId = env.APNS_KEY_ID ?? ""
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwt.keyId === keyId && cachedJwt.until > now) return cachedJwt.token
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(env.APNS_AUTH_KEY ?? ""),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    )
    const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }))
    const claims = base64Url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }))
    const unsigned = `${header}.${claims}`
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsigned),
    )
    const token = `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`
    cachedJwt = { token, until: now + 20 * 60, keyId }
    return token
  } catch {
    return null
  }
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "")
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function base64Url(value: string): string {
  return base64UrlBytes(new TextEncoder().encode(value))
}

function base64UrlBytes(bytes: Uint8Array): string {
  let text = ""
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}
