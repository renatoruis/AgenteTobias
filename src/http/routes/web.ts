import { CODE_SECONDS, generateCode, hashCode } from "../../application/auth/codes"
import { renameHousehold } from "../../application/auth/account"
import { expiresAt, readSession, SESSION_COOKIE, CHALLENGE_COOKIE } from "../../application/auth/session"
import { createInvite, hasHousehold, revokeSession } from "../../application/auth/store"
import { createEntity } from "../../application/agent/sql"
import { activeToken, issueToken, revokeToken } from "../../application/mcp/tokens"
import { normalizeAlias } from "../../domain/alias"
import { TIME_ZONE } from "../../application/agent/context"
import { civilMonthRange } from "../../domain/dates"
import { formatEur } from "../../domain/money"
import { entityKindSchema } from "../../domain/tools"
import type { Role, Session } from "../../domain/types"
import type { Env } from "../../env"
import { GESTAO_CSS, GESTAO_JS } from "../web/assets"
import { documentPage } from "../web/document"
import { KIND_LABEL, ROLE_LABEL, TYPE_LABEL, errorText, escapeHtml } from "../web/text"
import type { Context } from "hono"
import { setCookie } from "hono/cookie"
import type { Hono } from "hono"

type WebEnv = { Bindings: Env }

const NO_STORE = { "cache-control": "no-store" }

export function registerWeb<E extends WebEnv>(app: Hono<E>): void {
  app.get("/gestao.css", (c) => c.body(GESTAO_CSS, 200, { "content-type": "text/css; charset=utf-8" }))
  app.get("/gestao.js", (c) =>
    c.body(GESTAO_JS, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }),
  )
  app.get("/", (c) => home(c))
  app.get("/casa", (c) => casa(c))
  app.post("/casa/nome", (c) => postNome(c))
  app.post("/casa/membros", (c) => postMembro(c))
  app.post("/casa/entidades", (c) => postEntidade(c))
  app.get("/estatisticas", (c) => estatisticas(c))
  app.get("/ligacao", (c) => ligacao(c))
  app.post("/ligacao", (c) => postLigacao(c))
  app.post("/sair", (c) => sair(c))
}

async function home<E extends WebEnv>(c: Context<E>) {
  const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
  if (session) return c.redirect("/casa", 303)
  const bootstrap = !(await hasHousehold(c.env.DB))
  const body = bootstrap
    ? `<h1>AgenteTobias</h1>
<p>Primeira vez. Cria a casa e a tua passkey.</p>
<p id="erro" class="erro"></p>
<form id="bootstrap">
  <label>Token de arranque <input name="token" required autocomplete="off"></label>
  <label>O teu nome <input name="displayName" required maxlength="80"></label>
  <label>Nome da casa <input name="householdName" required maxlength="80"></label>
  <button type="submit">Criar</button>
</form>`
    : `<h1>AgenteTobias</h1>
<p id="erro" class="erro"></p>
<p><button type="button" id="entrar">Entrar</button></p>
<h2>Tenho um convite</h2>
<form id="convite">
  <label>Código <input name="inviteCode" required autocomplete="off"></label>
  <label>O teu nome <input name="displayName" required maxlength="80"></label>
  <button type="submit">Registar</button>
</form>`
  return c.html(documentPage("AgenteTobias", body, false), 200, NO_STORE)
}

async function casa<E extends WebEnv>(c: Context<E>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  const house = await loadHouse(c.env.DB, session.householdId)
  const notice = errorText(c.req.query("erro"))
  const owner = session.role === "owner"
  const kinds = entityKindSchema.options
    .map((kind) => `<option value="${kind}">${escapeHtml(KIND_LABEL[kind] ?? kind)}</option>`)
    .join("")
  const members = house.members
    .map((member) => `<li>${escapeHtml(member.display_name)} — ${escapeHtml(ROLE_LABEL[member.role] ?? member.role)}</li>`)
    .join("")
  const entities = house.entities
    .map((entity) => {
      const alias = entity.aliases.filter((item) => item !== normalizeAlias(entity.name))
      const extra = alias.length > 0 ? ` (${alias.map((item) => escapeHtml(item)).join(", ")})` : ""
      return `<li>${escapeHtml(KIND_LABEL[entity.kind] ?? entity.kind)}: ${escapeHtml(entity.name)}${extra}</li>`
    })
    .join("")
  const forms = owner
    ? `<h2>Nome da casa</h2>
<form method="post" action="/casa/nome">
  <label>Nome <input name="name" required maxlength="80" value="${escapeHtml(house.name)}"></label>
  <button type="submit">Guardar</button>
</form>
<h2>Novo membro</h2>
<form method="post" action="/casa/membros">
  <label>Nome <input name="displayName" required maxlength="80"></label>
  <label>Papel <select name="role">
    <option value="adult">Adulto</option>
    <option value="member">Membro</option>
    <option value="child">Criança</option>
  </select></label>
  <button type="submit">Criar convite</button>
</form>
<h2>Nova coisa da casa</h2>
<form method="post" action="/casa/entidades">
  <label>Tipo <select name="kind">${kinds}</select></label>
  <label>Nome <input name="name" required maxlength="80"></label>
  <label>Outro nome, se houver <input name="alias" maxlength="80"></label>
  <button type="submit">Guardar</button>
</form>`
    : `<p>Só o dono altera a casa.</p>`
  const body = `<h1>${escapeHtml(house.name)}</h1>
${notice ? `<p class="erro">${escapeHtml(notice)}</p>` : ""}
<h2>Membros</h2>
<ul>${members || "<li>Ainda não há membros.</li>"}</ul>
<h2>Casa</h2>
<ul>${entities || "<li>Ainda não há carros, lojas nem outros nomes.</li>"}</ul>
${forms}`
  return c.html(documentPage("Casa", body, true), 200, NO_STORE)
}

async function postNome<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const name = readName(await readField(c, "name"))
  if (!name) return c.redirect("/casa?erro=nome", 303)
  const renamed = await renameHousehold(c.env.DB, session.householdId, name)
  if (!renamed) return c.redirect("/casa?erro=dados", 303)
  return c.redirect("/casa", 303)
}

async function postMembro<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const pepper = c.env.PIN_PEPPER
  if (!pepper) return c.redirect("/casa?erro=indisponivel", 303)
  const form = await c.req.parseBody()
  const displayName = readName(field(form, "displayName"))
  const role = readRole(field(form, "role"))
  if (!displayName || !role) return c.redirect("/casa?erro=dados", 303)
  const now = new Date()
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
  const body = `<h1>Convite</h1>
<p>Dá este código a ${escapeHtml(displayName)}. Mostra-se só agora.</p>
<p class="codigo">${escapeHtml(code)}</p>
<p><a href="/casa">Voltar à casa</a></p>`
  return c.html(documentPage("Convite", body, true), 200, NO_STORE)
}

async function postEntidade<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const form = await c.req.parseBody()
  const kind = entityKindSchema.safeParse(field(form, "kind"))
  const name = readName(field(form, "name"))
  if (!kind.success || !name) return c.redirect("/casa?erro=dados", 303)
  const normalized = normalizeAlias(name)
  if (!normalized) return c.redirect("/casa?erro=nome", 303)
  try {
    const entity = await createEntity(c.env.DB, session.householdId, kind.data, name, normalized)
    const alias = readName(field(form, "alias"))
    const extra = alias ? normalizeAlias(alias) : ""
    if (extra && extra !== normalized) {
      await c.env.DB.prepare(
        "INSERT INTO aliases (id, household_id, entity_id, normalized) VALUES (?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), session.householdId, entity.id, extra)
        .run()
    }
  } catch {
    return c.redirect("/casa?erro=existe", 303)
  }
  return c.redirect("/casa", 303)
}

async function estatisticas<E extends WebEnv>(c: Context<E>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  const now = new Date()
  const range = civilMonthRange(now, TIME_ZONE)
  const filter = visibilityFilter(session)
  const rows = await c.env.DB.prepare(
    `SELECT type, COUNT(*) AS n, COALESCE(SUM(amount_minor), 0) AS total
     FROM events
     WHERE household_id = ? AND status = 'active' AND occurred_at >= ? AND occurred_at < ? AND ${filter.sql}
     GROUP BY type
     ORDER BY n DESC`,
  )
    .bind(session.householdId, range.from, range.to, ...filter.binds)
    .all<{ type: string; n: number; total: number }>()
  const members = await count(c.env.DB, "SELECT COUNT(*) AS n FROM users WHERE household_id = ?", session.householdId)
  const entities = await count(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM entities WHERE household_id = ? AND status = 'active'",
    session.householdId,
  )
  const list = rows.results ?? []
  const expense = sumOf(list, "expense")
  const income = sumOf(list, "income")
  const facts = list.reduce((total, row) => total + Number(row.n), 0)
  const month = new Intl.DateTimeFormat("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(now)
  const table = list
    .map((row) => {
      const money = row.type === "expense" || row.type === "income" ? formatEur(Number(row.total)) : ""
      return `<tr><td>${escapeHtml(TYPE_LABEL[row.type] ?? row.type)}</td><td>${Number(row.n)}</td><td>${escapeHtml(money)}</td></tr>`
    })
    .join("")
  const body = `<h1>Estatísticas</h1>
<p>${escapeHtml(month)}</p>
<div class="numeros">
  <p>Despesas<br><strong>${escapeHtml(formatEur(expense))}</strong></p>
  <p>Receitas<br><strong>${escapeHtml(formatEur(income))}</strong></p>
  <p>Factos<br><strong>${facts}</strong></p>
  <p>Membros<br><strong>${members}</strong></p>
  <p>Coisas da casa<br><strong>${entities}</strong></p>
</div>
${table ? `<table><tr><th>Tipo</th><th>Quantidade</th><th>Valor</th></tr>${table}</table>` : "<p>Ainda não há factos este mês.</p>"}`
  return c.html(documentPage("Estatísticas", body, true), 200, NO_STORE)
}

async function ligacao<E extends WebEnv>(c: Context<E>, token?: string) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  if (session.role !== "owner") {
    return c.html(documentPage("API", "<h1>API</h1><p>Só o dono gere a ligação.</p>", true), 403, NO_STORE)
  }
  const active = await activeToken(c.env.DB, session.householdId)
  const url = mcpUrl(c.req.url)
  const shown = token
    ? `<p>Copia o token. Não volta a aparecer.</p>
<p class="codigo" id="token">${escapeHtml(token)}</p>
<p><button type="button" id="copiar">Copiar</button></p>`
    : ""
  const status = active
    ? `<p>Token activo desde ${escapeHtml(formatWhen(active.created_at))}.</p>
<form method="post" action="/ligacao">
  <input type="hidden" name="action" value="revoke">
  <input type="hidden" name="id" value="${escapeHtml(active.id)}">
  <button type="submit">Revogar</button>
</form>`
    : "<p>Ainda não há token.</p>"
  const body = `<h1>API</h1>
<p>No Claude ou no Cursor, adiciona um servidor MCP com este URL e o cabeçalho <span class="codigo">Authorization: Bearer</span> seguido do token.</p>
<p class="codigo">${escapeHtml(url)}</p>
${shown}
${status}
<form method="post" action="/ligacao">
  <input type="hidden" name="action" value="create">
  <button type="submit">Criar token</button>
</form>`
  return c.html(documentPage("API", body, true), 200, NO_STORE)
}

async function postLigacao<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const form = await c.req.parseBody()
  const action = field(form, "action")
  if (action === "revoke") {
    const id = field(form, "id")
    if (id) await revokeToken(c.env.DB, session.householdId, id, new Date())
    return c.redirect("/ligacao", 303)
  }
  if (action !== "create") return c.redirect("/ligacao", 303)
  const pepper = c.env.PIN_PEPPER
  if (!pepper) return c.html(documentPage("API", "<h1>API</h1><p>A ligação não está disponível.</p>", true), 503, NO_STORE)
  const token = await issueToken(c.env.DB, session, pepper, new Date())
  return ligacao(c, token)
}

async function sair<E extends WebEnv>(c: Context<E>) {
  const now = new Date()
  const sessionId = readCookieValue(c.req.header("cookie") ?? null, SESSION_COOKIE)
  if (sessionId) await revokeSession(c.env.DB, sessionId, now.toISOString())
  clearCookie(c, SESSION_COOKIE)
  clearCookie(c, CHALLENGE_COOKIE)
  return c.redirect("/", 303)
}

async function requireSession<E extends WebEnv>(c: Context<E>): Promise<Session | Response> {
  const session = await readSession(c.env.DB, c.req.header("cookie") ?? null, new Date())
  if (!session) return c.redirect("/", 303)
  return session
}

async function requireOwner<E extends WebEnv>(c: Context<E>): Promise<Session | Response> {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  if (session.role !== "owner") {
    return c.html(documentPage("Casa", "<h1>Casa</h1><p>Só o dono faz isto.</p>", true), 403, NO_STORE)
  }
  return session
}

type MemberRow = { id: string; display_name: string; role: string }
type EntityRow = { id: string; kind: string; name: string; normalized: string | null }

async function loadHouse(db: D1Database, householdId: string) {
  const household = await db
    .prepare("SELECT name FROM households WHERE id = ?")
    .bind(householdId)
    .first<{ name: string }>()
  const members = await db
    .prepare("SELECT id, display_name, role FROM users WHERE household_id = ? ORDER BY display_name")
    .bind(householdId)
    .all<MemberRow>()
  const listed = await db
    .prepare(
      `SELECT e.id, e.kind, e.name, a.normalized
       FROM entities e
       LEFT JOIN aliases a ON a.entity_id = e.id AND a.household_id = e.household_id
       WHERE e.household_id = ? AND e.status = 'active'
       ORDER BY e.kind, e.name`,
    )
    .bind(householdId)
    .all<EntityRow>()
  const grouped = new Map<string, { id: string; kind: string; name: string; aliases: string[] }>()
  for (const row of listed.results ?? []) {
    const current = grouped.get(row.id) ?? { id: row.id, kind: row.kind, name: row.name, aliases: [] }
    if (row.normalized) current.aliases.push(row.normalized)
    grouped.set(row.id, current)
  }
  return {
    name: household?.name ?? "Casa",
    members: members.results ?? [],
    entities: [...grouped.values()],
  }
}

function visibilityFilter(session: Session): { sql: string; binds: string[] } {
  if (session.role === "owner") return { sql: "1 = 1", binds: [] }
  if (session.role === "adult") {
    return {
      sql: "(visibility IN ('household', 'adults') OR (visibility = 'private' AND actor_id = ?))",
      binds: [session.userId],
    }
  }
  return {
    sql: "(visibility = 'household' OR (visibility = 'private' AND actor_id = ?))",
    binds: [session.userId],
  }
}

async function count(db: D1Database, sql: string, householdId: string): Promise<number> {
  const row = await db.prepare(sql).bind(householdId).first<{ n: number }>()
  return Number(row?.n ?? 0)
}

function sumOf(rows: Array<{ type: string; total: number }>, type: string): number {
  const row = rows.find((item) => item.type === type)
  return row ? Number(row.total) : 0
}

function mcpUrl(requestUrl: string): string {
  const url = new URL("/mcp", requestUrl)
  if (url.hostname === "tobias.timdevops.com.br") url.protocol = "https:"
  return url.href
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium", timeStyle: "short", timeZone: TIME_ZONE }).format(date)
}

function readRole(value: string): Exclude<Role, "owner"> | null {
  if (value === "adult" || value === "member" || value === "child") return value
  return null
}

function readName(value: string): string | null {
  const name = value.trim()
  if (name.length < 1 || name.length > 80) return null
  return name
}

async function readField(c: Context, name: string): Promise<string> {
  const form = await c.req.parseBody()
  return field(form, name)
}

function field(form: Record<string, string | File>, name: string): string {
  const value = form[name]
  return typeof value === "string" ? value : ""
}

function readCookieValue(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return null
}

function clearCookie(c: Context, name: string) {
  setCookie(c, name, "", { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 0 })
}
