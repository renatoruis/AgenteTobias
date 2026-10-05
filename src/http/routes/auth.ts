import { canRead } from "../../domain/access"
import type { Role, Session, Visibility } from "../../domain/types"
import type { Env } from "../../env"
import { CODE_SECONDS, generateCode, hashCode } from "../../application/auth/codes"
import { clearPinFailures, hashPin, isPin, pinLocked, recordPinFailure, verifyPin } from "../../application/auth/pin"
import { safeEqual } from "../../application/auth/codec"
import {
  BOOTSTRAP_SECONDS,
  CHALLENGE_COOKIE,
  CHALLENGE_SECONDS,
  DEVICE_COOKIE,
  DEVICE_SECONDS,
  KIOSK_SECONDS,
  PERSONAL_SECONDS,
  SESSION_COOKIE,
  decodeChallenge,
  encodeChallenge,
  expiresAt,
  readCookie,
  readSession,
  type ChallengePayload,
} from "../../application/auth/session"
import {
  consumeKioskCode,
  createBootstrap,
  createInvite,
  createKiosk,
  credentialIds,
  findCode,
  findDevice,
  findKioskByCode,
  findPasskey,
  findUser,
  hasHousehold,
  loadMe,
  openKioskSession,
  openPersonalSession,
  redeemInvite,
  revokeSession,
  savePasskey,
  setPin,
  type MeBody,
} from "../../application/auth/store"
import {
  asAuthenticationResponse,
  asRegistrationResponse,
  authenticationOptions,
  configuredOrigin,
  publicKeyToStored,
  registrationOptions,
  resolveOrigins,
  storedToCredential,
  userHandleMatches,
  verifyAuthentication,
  verifyRegistration,
} from "../../application/auth/webauthn"
import type { Context } from "hono"
import { Hono } from "hono"
import { setCookie } from "hono/cookie"

type AuthEnv = { Bindings: Env }

const SESSION_MISSING = "Sessão em falta."
const UNAUTHORIZED = "Não autorizado."
const FORBIDDEN = "Não tens permissão."
const HOUSE_EXISTS = "A casa já existe."
const INVALID = "Pedido inválido."
const INVITE_INVALID = "Convite inválido."
const PIN_INVALID = "PIN inválido."
const NOT_FOUND = "Não encontrado."
const UNAVAILABLE = "Falhou. Tenta outra vez."

function fail(
  c: Context,
  status: 400 | 401 | 403 | 404 | 503,
  code: "validation" | "unauthorized" | "forbidden" | "not_found" | "unavailable",
  message: string,
) {
  return c.json({ error: { code, message } }, status)
}

function writeCookie(c: Context, name: string, value: string, maxAge: number) {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge,
  })
}

function cookieHeader(c: Context): string | null {
  return c.req.header("Cookie") ?? null
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) return null
    return body as Record<string, unknown>
  } catch {
    return null
  }
}

function readName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (name.length < 1 || name.length > 80) return null
  return name
}

function inviteRole(value: unknown): Exclude<Role, "owner"> | null {
  if (value === "adult" || value === "member" || value === "child") return value
  return null
}

function isInviteRole(value: string): value is Exclude<Role, "owner"> {
  return value === "adult" || value === "member" || value === "child"
}

function pepperOf(env: Env): string | null {
  return env.PIN_PEPPER ? env.PIN_PEPPER : null
}

function originsOf<E extends AuthEnv>(c: Context<E>): string[] {
  return resolveOrigins(c.req.url, configuredOrigin(c.env))
}

async function requireSession<E extends AuthEnv>(c: Context<E>, now: Date): Promise<Session | Response> {
  const session = await readSession(c.env.DB, cookieHeader(c), now)
  if (!session) return fail(c, 401, "unauthorized", SESSION_MISSING)
  return session
}

function writeChallenge(c: Context, payload: ChallengePayload) {
  writeCookie(c, CHALLENGE_COOKIE, encodeChallenge(payload), CHALLENGE_SECONDS)
}

async function issueRegistration<E extends AuthEnv>(c: Context<E>, user: { id: string; displayName: string }) {
  const options = await registrationOptions(user, await credentialIds(c.env.DB, user.id))
  writeChallenge(c, { challenge: options.challenge, purpose: "register", userId: user.id })
  return options
}

export function registerAuth<E extends AuthEnv>(app: Hono<E>): void {
  app.post("/api/bootstrap", (c) => bootstrap(c))
  app.post("/api/auth/register/options", (c) => registerOptions(c))
  app.post("/api/auth/register", (c) => register(c))
  app.post("/api/auth/login/options", (c) => loginOptions(c))
  app.post("/api/auth/login", (c) => login(c))
  app.post("/api/auth/logout", (c) => logout(c))
  app.get("/api/me", (c) => me(c))
  app.post("/api/invites", (c) => invites(c))
  app.post("/api/kiosk/devices", (c) => kioskDevice(c))
  app.post("/api/kiosk/unlock", (c) => kioskUnlock(c))
  app.post("/api/users/:id/pin", (c) => setUserPin(c))
}

async function bootstrap<E extends AuthEnv>(c: Context<E>) {
  const body = await readJson(c)
  const token = body && typeof body.token === "string" ? body.token : ""
  if (!token || token.length > 512 || !c.env.BOOTSTRAP_TOKEN || !safeEqual(token, c.env.BOOTSTRAP_TOKEN)) {
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }
  const displayName = body ? readName(body.displayName) : null
  const householdName = body ? readName(body.householdName) : null
  if (!displayName || !householdName) return fail(c, 400, "validation", INVALID)
  if (await hasHousehold(c.env.DB)) return fail(c, 403, "forbidden", HOUSE_EXISTS)

  const now = new Date()
  const householdId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  const deviceId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  await createBootstrap(c.env.DB, {
    householdId,
    householdName,
    userId,
    displayName,
    deviceId,
    deviceName: "primeiro telemóvel",
    sessionId,
    now: now.toISOString(),
    expiresAt: expiresAt(now, BOOTSTRAP_SECONDS),
  })
  writeCookie(c, SESSION_COOKIE, sessionId, BOOTSTRAP_SECONDS)
  writeCookie(c, DEVICE_COOKIE, deviceId, DEVICE_SECONDS)
  const profile: MeBody = {
    user: { id: userId, displayName, role: "owner" },
    household: {
      id: householdId,
      name: householdName,
      timezone: "Europe/Lisbon",
      currency: "EUR",
      locale: "pt-PT",
    },
  }
  try {
    const options = await issueRegistration(c, profile.user)
    return c.json({ ...profile, registration: "pending" as const, options })
  } catch {
    return fail(c, 503, "unavailable", UNAVAILABLE)
  }
}

async function registerOptions<E extends AuthEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  const profile = await loadMe(c.env.DB, session.userId, session.householdId)
  if (!profile) return fail(c, 401, "unauthorized", SESSION_MISSING)
  try {
    return c.json({ options: await issueRegistration(c, profile.user) })
  } catch {
    return fail(c, 503, "unavailable", UNAVAILABLE)
  }
}

async function register<E extends AuthEnv>(c: Context<E>) {
  const body = await readJson(c)
  if (!body) return fail(c, 400, "validation", INVALID)
  const now = new Date()
  const session = await readSession(c.env.DB, cookieHeader(c), now)
  if (typeof body.inviteCode === "string") {
    if (session) return fail(c, 400, "validation", INVALID)
    return redeem(c, body, now)
  }
  if (!session) return fail(c, 401, "unauthorized", SESSION_MISSING)
  return finishPasskey(c, body, session, now)
}

async function redeem<E extends AuthEnv>(c: Context<E>, body: Record<string, unknown>, now: Date) {
  const inviteCode = body.inviteCode
  const displayName = readName(body.displayName)
  if (typeof inviteCode !== "string" || !displayName) return fail(c, 400, "validation", INVALID)
  if (inviteCode.length < 8 || inviteCode.length > 64) return fail(c, 400, "validation", INVITE_INVALID)
  const pepper = pepperOf(c.env)
  if (!pepper) return fail(c, 503, "unavailable", UNAVAILABLE)
  const invite = await findCode(c.env.DB, await hashCode("invite", inviteCode, pepper))
  if (!invite || invite.usedAt || !isInviteRole(invite.role)) {
    return fail(c, 400, "validation", INVITE_INVALID)
  }
  const expiry = Date.parse(invite.expiresAt)
  if (Number.isNaN(expiry) || expiry <= now.getTime()) return fail(c, 400, "validation", INVITE_INVALID)
  const user = await findUser(c.env.DB, invite.id)
  if (!user || user.householdId !== invite.householdId || user.role !== invite.role) {
    return fail(c, 400, "validation", INVITE_INVALID)
  }
  const deviceId = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const redeemed = await redeemInvite(c.env.DB, {
    userId: user.id,
    householdId: user.householdId,
    displayName,
    deviceId,
    deviceName: "telemóvel",
    sessionId,
    now: now.toISOString(),
    expiresAt: expiresAt(now, BOOTSTRAP_SECONDS),
  })
  if (!redeemed) return fail(c, 400, "validation", INVITE_INVALID)
  writeCookie(c, SESSION_COOKIE, sessionId, BOOTSTRAP_SECONDS)
  writeCookie(c, DEVICE_COOKIE, deviceId, DEVICE_SECONDS)
  const profile = await loadMe(c.env.DB, user.id, user.householdId)
  if (!profile) return fail(c, 503, "unavailable", UNAVAILABLE)
  try {
    const options = await issueRegistration(c, profile.user)
    return c.json({ ...profile, registration: "pending" as const, options })
  } catch {
    return fail(c, 503, "unavailable", UNAVAILABLE)
  }
}

async function finishPasskey<E extends AuthEnv>(c: Context<E>, body: Record<string, unknown>, session: Session, now: Date) {
  const credential = asRegistrationResponse(body)
  if (!credential) return fail(c, 400, "validation", INVALID)
  const challenge = decodeChallenge(readCookie(cookieHeader(c), CHALLENGE_COOKIE))
  if (!challenge || challenge.purpose !== "register" || challenge.userId !== session.userId) {
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }
  const sessionId = readCookie(cookieHeader(c), SESSION_COOKIE)
  if (!sessionId) return fail(c, 401, "unauthorized", SESSION_MISSING)
  let verification: Awaited<ReturnType<typeof verifyRegistration>>
  try {
    verification = await verifyRegistration(credential, challenge.challenge, originsOf(c))
  } catch {
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }
  if (!verification.verified) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  const saved = await savePasskey(c.env.DB, {
    id: crypto.randomUUID(),
    userId: session.userId,
    credentialId: verification.registrationInfo.credential.id,
    publicKey: publicKeyToStored(verification.registrationInfo.credential.publicKey),
    signCount: verification.registrationInfo.credential.counter,
    sessionId,
    expiresAt: expiresAt(now, PERSONAL_SECONDS),
  })
  if (saved === "conflict") return fail(c, 400, "validation", INVALID)
  writeCookie(c, SESSION_COOKIE, sessionId, PERSONAL_SECONDS)
  writeCookie(c, CHALLENGE_COOKIE, "", 0)
  const profile = await loadMe(c.env.DB, session.userId, session.householdId)
  if (!profile) return fail(c, 401, "unauthorized", SESSION_MISSING)
  return c.json(profile)
}

async function loginOptions<E extends AuthEnv>(c: Context<E>) {
  try {
    const options = await authenticationOptions()
    writeChallenge(c, { challenge: options.challenge, purpose: "login" })
    return c.json({ options })
  } catch {
    return fail(c, 503, "unavailable", UNAVAILABLE)
  }
}

async function login<E extends AuthEnv>(c: Context<E>) {
  const body = await readJson(c)
  if (!body) return fail(c, 400, "validation", INVALID)
  const credential = asAuthenticationResponse(body)
  if (!credential) return fail(c, 400, "validation", INVALID)
  const now = new Date()
  const challenge = decodeChallenge(readCookie(cookieHeader(c), CHALLENGE_COOKIE))
  if (!challenge || challenge.purpose !== "login") return fail(c, 401, "unauthorized", UNAUTHORIZED)
  const passkey = await findPasskey(c.env.DB, credential.id)
  if (!passkey) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  let verification: Awaited<ReturnType<typeof verifyAuthentication>>
  try {
    verification = await verifyAuthentication(
      credential,
      challenge.challenge,
      originsOf(c),
      storedToCredential(passkey.credentialId, passkey.publicKey, passkey.signCount),
    )
  } catch {
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }
  if (!verification.verified || !userHandleMatches(credential.response.userHandle, passkey.userId)) {
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }

  const deviceCookie = readCookie(cookieHeader(c), DEVICE_COOKIE)
  const existing = deviceCookie ? await findDevice(c.env.DB, deviceCookie) : null
  const reuse =
    existing?.kind === "personal" && existing.householdId === passkey.householdId ? existing : null
  const deviceId = reuse?.id ?? crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  await openPersonalSession(c.env.DB, {
    sessionId,
    userId: passkey.userId,
    deviceId,
    expiresAt: expiresAt(now, PERSONAL_SECONDS),
    passkeyId: passkey.id,
    signCount: verification.authenticationInfo.newCounter,
    newDevice: reuse
      ? null
      : { householdId: passkey.householdId, name: "telemóvel", now: now.toISOString() },
  })
  const profile = await loadMe(c.env.DB, passkey.userId, passkey.householdId)
  if (!profile) return fail(c, 503, "unavailable", UNAVAILABLE)
  writeCookie(c, SESSION_COOKIE, sessionId, PERSONAL_SECONDS)
  if (!reuse && existing?.kind !== "kiosk") writeCookie(c, DEVICE_COOKIE, deviceId, DEVICE_SECONDS)
  writeCookie(c, CHALLENGE_COOKIE, "", 0)
  return c.json(profile)
}

async function logout<E extends AuthEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  const sessionId = readCookie(cookieHeader(c), SESSION_COOKIE)
  if (!sessionId) return fail(c, 401, "unauthorized", SESSION_MISSING)
  await revokeSession(c.env.DB, sessionId, now.toISOString())
  writeCookie(c, SESSION_COOKIE, "", 0)
  writeCookie(c, CHALLENGE_COOKIE, "", 0)
  return c.body(null, 204)
}

async function me<E extends AuthEnv>(c: Context<E>) {
  const session = await requireSession(c, new Date())
  if (session instanceof Response) return session
  const profile = await loadMe(c.env.DB, session.userId, session.householdId)
  if (!profile) return fail(c, 401, "unauthorized", SESSION_MISSING)
  return c.json(profile)
}

async function invites<E extends AuthEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  if (session.role !== "owner") return fail(c, 403, "forbidden", FORBIDDEN)
  const body = await readJson(c)
  if (!body) return fail(c, 400, "validation", INVALID)
  const role = inviteRole(body.role)
  const displayName = readName(body.displayName)
  if (!role || !displayName) return fail(c, 400, "validation", INVALID)
  const pepper = pepperOf(c.env)
  if (!pepper) return fail(c, 503, "unavailable", UNAVAILABLE)
  const code = generateCode()
  await createInvite(c.env.DB, {
    userId: crypto.randomUUID(),
    householdId: session.householdId,
    displayName,
    role,
    codeHash: await hashCode("invite", code, pepper),
    now: now.toISOString(),
    expiresAt: expiresAt(now, CODE_SECONDS),
  })
  return c.json({ code, expiresAt: expiresAt(now, CODE_SECONDS), role })
}

async function kioskDevice<E extends AuthEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  if (session.role !== "owner") return fail(c, 403, "forbidden", FORBIDDEN)
  const body = await readJson(c)
  const name = body ? readName(body.name) : null
  if (!name) return fail(c, 400, "validation", INVALID)
  const pepper = pepperOf(c.env)
  if (!pepper) return fail(c, 503, "unavailable", UNAVAILABLE)
  const code = generateCode()
  const deviceId = crypto.randomUUID()
  const expires = expiresAt(now, CODE_SECONDS)
  await createKiosk(c.env.DB, {
    deviceId,
    householdId: session.householdId,
    name,
    codeHash: await hashCode("kiosk", code, pepper),
    now: now.toISOString(),
    expiresAt: expires,
  })
  return c.json({ code, expiresAt: expires, deviceId })
}

async function kioskUnlock<E extends AuthEnv>(c: Context<E>) {
  const body = await readJson(c)
  if (!body) return fail(c, 400, "validation", INVALID)
  const deviceCode = body.deviceCode
  const userId = body.userId
  if (typeof deviceCode !== "string" || typeof userId !== "string") return fail(c, 400, "validation", INVALID)
  if (!isPin(body.pin)) return fail(c, 400, "validation", PIN_INVALID)
  if (deviceCode.length < 1 || deviceCode.length > 80) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  const pepper = pepperOf(c.env)
  if (!pepper) return fail(c, 503, "unavailable", UNAVAILABLE)
  const now = new Date()
  const device = await resolveKiosk(c, deviceCode, pepper, now)
  if (!device) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  if (pinLocked(device.deviceId, now)) return fail(c, 401, "unauthorized", UNAUTHORIZED)
  const user = await findUser(c.env.DB, userId)
  if (!user || user.householdId !== device.householdId) {
    recordPinFailure(device.deviceId, now)
    return fail(c, 404, "not_found", NOT_FOUND)
  }
  if (!(await verifyPin(body.pin, pepper, user.pinHash))) {
    recordPinFailure(device.deviceId, now)
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }
  if (device.consume && !(await consumeKioskCode(c.env.DB, device.deviceId, now.toISOString()))) {
    return fail(c, 401, "unauthorized", UNAUTHORIZED)
  }
  clearPinFailures(device.deviceId)
  const sessionId = crypto.randomUUID()
  await openKioskSession(c.env.DB, {
    sessionId,
    userId: user.id,
    deviceId: device.deviceId,
    expiresAt: expiresAt(now, KIOSK_SECONDS),
  })
  const profile = await loadMe(c.env.DB, user.id, user.householdId)
  if (!profile) return fail(c, 503, "unavailable", UNAVAILABLE)
  writeCookie(c, SESSION_COOKIE, sessionId, KIOSK_SECONDS)
  writeCookie(c, DEVICE_COOKIE, device.deviceId, DEVICE_SECONDS)
  return c.json(profile)
}

async function resolveKiosk<E extends AuthEnv>(c: Context<E>, deviceCode: string, pepper: string, now: Date) {
  const deviceCookie = readCookie(cookieHeader(c), DEVICE_COOKIE)
  const pairedCode = await findKioskByCode(c.env.DB, await hashCode("kiosk", deviceCode, pepper))
  if (pairedCode) {
    const expiry = Date.parse(pairedCode.expiresAt)
    const expired = Number.isNaN(expiry) || expiry <= now.getTime()
    if (pairedCode.usedAt) {
      if (deviceCookie === pairedCode.id) {
        return { deviceId: pairedCode.id, householdId: pairedCode.householdId, consume: false }
      }
    } else if (!expired) {
      return { deviceId: pairedCode.id, householdId: pairedCode.householdId, consume: true }
    }
  }
  if (deviceCookie && deviceCookie === deviceCode) {
    const paired = await findDevice(c.env.DB, deviceCode)
    if (paired?.kind === "kiosk") {
      return { deviceId: paired.id, householdId: paired.householdId, consume: false }
    }
  }
  return null
}

async function setUserPin<E extends AuthEnv>(c: Context<E>) {
  const now = new Date()
  const session = await requireSession(c, now)
  if (session instanceof Response) return session
  const body = await readJson(c)
  if (!body || !isPin(body.pin)) return fail(c, 400, "validation", PIN_INVALID)
  const pepper = pepperOf(c.env)
  if (!pepper) return fail(c, 503, "unavailable", UNAVAILABLE)
  const userId = c.req.param("id")
  if (!userId) return fail(c, 404, "not_found", NOT_FOUND)
  const user = await findUser(c.env.DB, userId)
  if (!user || user.householdId !== session.householdId) return fail(c, 404, "not_found", NOT_FOUND)
  const ownAdult = session.role === "adult" && session.userId === user.id
  if (session.role !== "owner" && !ownAdult) return fail(c, 403, "forbidden", FORBIDDEN)
  const saved = await setPin(c.env.DB, user.id, session.householdId, await hashPin(body.pin, pepper))
  if (!saved) return fail(c, 404, "not_found", NOT_FOUND)
  return c.body(null, 204)
}

export function sessionMayRead(
  session: Session,
  visibility: Visibility,
  actorId: string,
): boolean {
  return canRead(session.role, visibility, actorId, session.userId)
}
