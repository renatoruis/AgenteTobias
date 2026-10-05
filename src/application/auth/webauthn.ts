import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server"
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server"
import { base64ToBytes, base64UrlToBytes, bytesToBase64 } from "./codec"

export const RP_ID = "timdevops.com.br"
export const PRODUCTION_ORIGIN = "https://tobias.timdevops.com.br"
const RP_NAME = "AgenteTobias"

export function configuredOrigin(env: object): string | undefined {
  const fromEnv = (env as { WEB_AUTHN_ORIGIN?: unknown }).WEB_AUTHN_ORIGIN
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim()
  const meta = import.meta as unknown as { env?: { WEB_AUTHN_ORIGIN?: unknown } }
  const fromMeta = meta.env?.WEB_AUTHN_ORIGIN
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim()
  return undefined
}

export function resolveOrigins(requestUrl: string, configured: string | undefined): string[] {
  const origins = [PRODUCTION_ORIGIN]
  if (!configured || configured === PRODUCTION_ORIGIN) return origins
  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch {
    return origins
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return origins
  if (parsed.origin === PRODUCTION_ORIGIN) return origins
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
  if (local) {
    let host = ""
    try {
      host = new URL(requestUrl).hostname
    } catch {
      return origins
    }
    if (host !== "localhost" && host !== "127.0.0.1") return origins
  }
  origins.push(parsed.origin)
  return origins
}

export async function registrationOptions(
  user: { id: string; displayName: string },
  excludeCredentialIds: string[],
) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.displayName,
    userDisplayName: user.displayName,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: excludeCredentialIds.map((id) => ({ id })),
  })
}

export async function authenticationOptions() {
  return generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
  })
}

export async function verifyRegistration(
  response: RegistrationResponseJSON,
  challenge: string,
  origins: string[],
) {
  return verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origins,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  })
}

export async function verifyAuthentication(
  response: AuthenticationResponseJSON,
  challenge: string,
  origins: string[],
  credential: WebAuthnCredential,
) {
  return verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origins,
    expectedRPID: RP_ID,
    credential,
    requireUserVerification: true,
  })
}

export function publicKeyToStored(publicKey: Uint8Array): string {
  return bytesToBase64(publicKey)
}

export function storedToCredential(id: string, publicKey: string, counter: number): WebAuthnCredential {
  return {
    id,
    publicKey: new Uint8Array(base64ToBytes(publicKey)),
    counter,
  }
}

export function userHandleMatches(userHandle: string | undefined, userId: string): boolean {
  if (!userHandle) return true
  try {
    const text = new TextDecoder().decode(base64UrlToBytes(userHandle))
    return text === userId
  } catch {
    return false
  }
}

export function asRegistrationResponse(body: Record<string, unknown>): RegistrationResponseJSON | null {
  const response = body.response
  if (typeof body.id !== "string" || typeof body.rawId !== "string" || body.type !== "public-key") return null
  if (!response || typeof response !== "object" || Array.isArray(response)) return null
  const attestation = response as Record<string, unknown>
  if (typeof attestation.clientDataJSON !== "string" || typeof attestation.attestationObject !== "string") {
    return null
  }
  if (!body.clientExtensionResults || typeof body.clientExtensionResults !== "object") {
    body.clientExtensionResults = {}
  }
  return body as unknown as RegistrationResponseJSON
}

export function asAuthenticationResponse(body: Record<string, unknown>): AuthenticationResponseJSON | null {
  const response = body.response
  if (typeof body.id !== "string" || typeof body.rawId !== "string" || body.type !== "public-key") return null
  if (!response || typeof response !== "object" || Array.isArray(response)) return null
  const assertion = response as Record<string, unknown>
  if (typeof assertion.clientDataJSON !== "string") return null
  if (typeof assertion.authenticatorData !== "string" || typeof assertion.signature !== "string") return null
  if (!body.clientExtensionResults || typeof body.clientExtensionResults !== "object") {
    body.clientExtensionResults = {}
  }
  return body as unknown as AuthenticationResponseJSON
}
