import { CODE_SECONDS, generateCode, hashCode } from "../../application/auth/codes"
import { removeMember, renameHousehold, updateMember } from "../../application/auth/account"
import { expiresAt, readSession, SESSION_COOKIE, CHALLENGE_COOKIE } from "../../application/auth/session"
import { createInvite, hasHousehold, revokeSession } from "../../application/auth/store"
import { createEntity, retireEntity, updateEntity } from "../../application/agent/sql"
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
  app.post("/casa/membros/:id", (c) => postMembroId(c))
  app.post("/casa/entidades", (c) => postEntidade(c))
  app.post("/casa/entidades/:id", (c) => postEntidadeId(c))
  app.post("/casa/links", (c) => postLink(c))
  app.post("/casa/links/:id", (c) => postLinkId(c))
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
    ? `<h1>Tobias</h1>
<p class="lead">Cria a casa e a tua passkey.</p>
<p id="erro" class="erro"></p>
<form id="bootstrap">
  <div class="inset">
    <label class="field"><span>Token</span><input name="token" required autocomplete="off"></label>
    <label class="field"><span>O teu nome</span><input name="displayName" required maxlength="80" autocomplete="name"></label>
    <label class="field"><span>Casa</span><input name="householdName" required maxlength="80"></label>
  </div>
  <button class="primary" type="submit">Criar</button>
</form>`
    : `<h1>Tobias</h1>
<p class="lead">Entra com a tua passkey.</p>
<p id="erro" class="erro"></p>
<button class="primary" type="button" id="entrar">Entrar</button>
<h2>Tenho um convite</h2>
<form id="convite">
  <div class="inset">
    <label class="field"><span>Código</span><input name="inviteCode" required autocomplete="one-time-code" autocapitalize="characters"></label>
    <label class="field"><span>Nome</span><input name="displayName" required maxlength="80" autocomplete="name"></label>
    <button class="link" type="submit">Registar</button>
  </div>
</form>`
  return c.html(documentPage("Tobias", body, null), 200, NO_STORE)
}

async function casa<E extends WebEnv>(c: Context<E>) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  const house = await loadHouse(c.env.DB, session.householdId)
  const notice = errorText(c.req.query("erro"))
  const owner = session.role === "owner"
  const members = house.members
    .map((member) => (owner ? memberForm(member) : memberRow(member)))
    .join("")
  const entities = house.entities.map((entity) => (owner ? entityForm(entity) : entityRow(entity))).join("")
  const links = house.links.map((link) => (owner ? linkForm(link) : linkRow(link))).join("")
  const addMember = owner
    ? `<form method="post" action="/casa/membros">
  <h2>Novo membro</h2>
  <div class="inset">
    <label class="field"><span>Nome</span><input name="displayName" required maxlength="80" autocomplete="name"></label>
    <label class="field"><span>Papel</span><select name="role">
      <option value="adult">Adulto</option>
      <option value="member">Membro</option>
      <option value="child">Criança</option>
    </select></label>
    <label class="field"><span>Telefone</span><input name="phone" maxlength="40" inputmode="tel" autocomplete="tel" placeholder="+351"></label>
    <button class="link" type="submit">Criar convite</button>
  </div>
</form>`
    : ""
  const addEntity = owner
    ? `<form method="post" action="/casa/entidades">
  <h2>Nova coisa</h2>
  <div class="inset">
    <label class="field"><span>Tipo</span><select name="kind">${kindOptions("")}</select></label>
    <label class="field"><span>Nome</span><input name="name" required maxlength="80" placeholder="i30"></label>
    <label class="field"><span>Outro nome</span><input name="alias" maxlength="80" placeholder="o carro"></label>
    <button class="link" type="submit">Guardar</button>
  </div>
</form>`
    : ""
  const addLink = owner
    ? `<form method="post" action="/casa/links">
  <h2>Novo link</h2>
  <div class="inset">
    <label class="field"><span>Nome</span><input name="label" required maxlength="80" placeholder="Escola"></label>
    <label class="field"><span>Endereço</span><input name="url" required maxlength="500" inputmode="url" placeholder="https://"></label>
    <button class="link" type="submit">Guardar</button>
  </div>
</form>`
    : ""
  const rename = owner
    ? `<form method="post" action="/casa/nome">
  <h2>Nome da casa</h2>
  <div class="inset">
    <label class="field"><span>Nome</span><input name="name" required maxlength="80" value="${escapeHtml(house.name)}"></label>
    <button class="link" type="submit">Guardar</button>
  </div>
</form>`
    : `<p class="footnote">Só o dono altera a casa.</p>`
  const body = `<h1>${escapeHtml(house.name)}</h1>
${notice ? `<p class="banner">${escapeHtml(notice)}</p>` : ""}
${rename}
<h2>Membros</h2>
${members || `<div class="inset"><p class="row empty">Ainda não há membros.</p></div>`}
${addMember}
<h2>Coisas da casa</h2>
${entities || `<div class="inset"><p class="row empty">Ainda não há carros, lojas nem outros nomes.</p></div>`}
${addEntity}
<h2>Links</h2>
${links || `<div class="inset"><p class="row empty">Ainda não há links.</p></div>`}
${addLink}`
  return c.html(documentPage("Casa", body, "casa"), 200, NO_STORE)
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
  const phone = readPhone(field(form, "phone"))
  if (!displayName || !role) return c.redirect("/casa?erro=dados", 303)
  if (phone === false) return c.redirect("/casa?erro=telefone", 303)
  const now = new Date()
  const code = generateCode()
  await createInvite(c.env.DB, {
    userId: crypto.randomUUID(),
    householdId: session.householdId,
    displayName,
    role,
    phone,
    codeHash: await hashCode("invite", code, pepper),
    now: now.toISOString(),
    expiresAt: expiresAt(now, CODE_SECONDS),
  })
  const body = `<h1>Convite</h1>
<p class="sub">Para ${escapeHtml(displayName)}. Mostra-se só agora.</p>
<div class="inset">
  <p class="secret code" id="codigo">${escapeHtml(code)}</p>
  <button class="link" type="button" data-copy="codigo">Copiar código</button>
</div>
<p class="footnote"><a href="/casa">Voltar à casa</a></p>`
  return c.html(documentPage("Convite", body, "casa"), 200, NO_STORE)
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

async function postMembroId<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const id = readId(c.req.param("id") ?? "")
  if (!id) return c.redirect("/casa?erro=dados", 303)
  const form = await c.req.parseBody()
  if (field(form, "action") === "remove") {
    const removed = await removeMember(c.env.DB, session.householdId, id, new Date().toISOString())
    return c.redirect(removed ? "/casa" : "/casa?erro=dono", 303)
  }
  const displayName = readName(field(form, "displayName"))
  const phone = readPhone(field(form, "phone"))
  if (!displayName || phone === false) return c.redirect("/casa?erro=" + (displayName ? "telefone" : "nome"), 303)
  const saved = await updateMember(c.env.DB, session.householdId, id, displayName, readRole(field(form, "role")), phone)
  return c.redirect(saved ? "/casa" : "/casa?erro=dados", 303)
}

async function postEntidadeId<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const id = readId(c.req.param("id") ?? "")
  if (!id) return c.redirect("/casa?erro=dados", 303)
  const form = await c.req.parseBody()
  if (field(form, "action") === "remove") {
    await retireEntity(c.env.DB, session.householdId, id)
    return c.redirect("/casa", 303)
  }
  const kind = entityKindSchema.safeParse(field(form, "kind"))
  const name = readName(field(form, "name"))
  if (!kind.success || !name) return c.redirect("/casa?erro=dados", 303)
  const normalized = normalizeAlias(name)
  if (!normalized) return c.redirect("/casa?erro=nome", 303)
  const alias = readName(field(form, "alias"))
  const extra = alias ? normalizeAlias(alias) : ""
  const saved = await updateEntity(c.env.DB, session.householdId, id, kind.data, name, normalized, extra)
  if (saved === "exists") return c.redirect("/casa?erro=existe", 303)
  if (saved === "missing") return c.redirect("/casa?erro=dados", 303)
  return c.redirect("/casa", 303)
}

async function postLink<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const form = await c.req.parseBody()
  const label = readName(field(form, "label"))
  const url = readUrl(field(form, "url"))
  if (!label) return c.redirect("/casa?erro=nome", 303)
  if (!url) return c.redirect("/casa?erro=url", 303)
  await c.env.DB.prepare("INSERT INTO links (id, household_id, label, url, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), session.householdId, label, url, new Date().toISOString())
    .run()
  return c.redirect("/casa", 303)
}

async function postLinkId<E extends WebEnv>(c: Context<E>) {
  const session = await requireOwner(c)
  if (session instanceof Response) return session
  const id = readId(c.req.param("id") ?? "")
  if (!id) return c.redirect("/casa?erro=dados", 303)
  const form = await c.req.parseBody()
  if (field(form, "action") === "remove") {
    await c.env.DB.prepare("DELETE FROM links WHERE id = ? AND household_id = ?").bind(id, session.householdId).run()
    return c.redirect("/casa", 303)
  }
  const label = readName(field(form, "label"))
  const url = readUrl(field(form, "url"))
  if (!label) return c.redirect("/casa?erro=nome", 303)
  if (!url) return c.redirect("/casa?erro=url", 303)
  const saved = await c.env.DB.prepare("UPDATE links SET label = ?, url = ? WHERE id = ? AND household_id = ?")
    .bind(label, url, id, session.householdId)
    .run()
  return c.redirect((saved.meta.changes ?? 0) > 0 ? "/casa" : "/casa?erro=dados", 303)
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
  const members = await count(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM users WHERE household_id = ? AND removed_at IS NULL",
    session.householdId,
  )
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
      const money = row.type === "expense" || row.type === "income" ? ` · ${formatEur(Number(row.total))}` : ""
      return `<div class="row"><span>${escapeHtml(TYPE_LABEL[row.type] ?? row.type)}</span><span class="value">${Number(row.n)}${escapeHtml(money)}</span></div>`
    })
    .join("")
  const body = `<h1>Números</h1>
<p class="sub">${escapeHtml(month)}</p>
<div class="inset">
  <div class="row"><span>Despesas</span><span class="value">${escapeHtml(formatEur(expense))}</span></div>
  <div class="row"><span>Receitas</span><span class="value">${escapeHtml(formatEur(income))}</span></div>
  <div class="row"><span>Factos</span><span class="value">${facts}</span></div>
  <div class="row"><span>Membros</span><span class="value">${members}</span></div>
  <div class="row"><span>Coisas da casa</span><span class="value">${entities}</span></div>
</div>
<h2>Este mês</h2>
<div class="inset">${table || `<p class="row empty">Ainda não há factos este mês.</p>`}</div>`
  return c.html(documentPage("Números", body, "estatisticas"), 200, NO_STORE)
}

async function ligacao<E extends WebEnv>(c: Context<E>, token?: string) {
  const session = await requireSession(c)
  if (session instanceof Response) return session
  if (session.role !== "owner") {
    return c.html(
      documentPage("Ligação", `<h1>Ligação</h1><p class="footnote">Só o dono gere a ligação.</p>`, "ligacao"),
      403,
      NO_STORE,
    )
  }
  const active = await activeToken(c.env.DB, session.householdId)
  const url = mcpUrl(c.req.url)
  const shown = token
    ? `<h2>Token novo</h2>
<div class="inset">
  <p class="secret" id="token">${escapeHtml(token)}</p>
  <button class="link" type="button" data-copy="token">Copiar token</button>
</div>
<p class="footnote">Não volta a aparecer. Guarda-o agora.</p>`
    : ""
  const status = active
    ? `<h2>Token activo</h2>
<div class="inset"><p class="row"><span>Desde</span><span class="value">${escapeHtml(formatWhen(active.created_at))}</span></p></div>
<form method="post" action="/ligacao" data-confirm="Revogar este token?">
  <input type="hidden" name="action" value="revoke">
  <input type="hidden" name="id" value="${escapeHtml(active.id)}">
  <div class="inset"><button class="destructive" type="submit">Revogar token</button></div>
</form>`
    : ""
  const body = `<h1>Ligação</h1>
<p class="sub">Servidor MCP para o Claude ou o Cursor.</p>
<h2>Endereço</h2>
<div class="inset">
  <p class="secret" id="url">${escapeHtml(url)}</p>
  <button class="link" type="button" data-copy="url">Copiar endereço</button>
</div>
<p class="footnote">Cabeçalho Authorization: Bearer, seguido do token.</p>
${shown}
${status}
<form method="post" action="/ligacao">
  <input type="hidden" name="action" value="create">
  ${active ? "" : "<h2>Token</h2>"}
  <div class="inset">
    ${active ? "" : `<p class="row empty">Ainda não há token.</p>`}
    <button class="link" type="submit">${active ? "Criar outro token" : "Criar token"}</button>
  </div>
</form>`
  return c.html(documentPage("Ligação", body, "ligacao"), 200, NO_STORE)
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
  if (!pepper) {
    return c.html(
      documentPage("Ligação", `<h1>Ligação</h1><p class="footnote">A ligação não está disponível.</p>`, "ligacao"),
      503,
      NO_STORE,
    )
  }
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
    return c.html(documentPage("Casa", `<h1>Casa</h1><p class="footnote">Só o dono faz isto.</p>`, "casa"), 403, NO_STORE)
  }
  return session
}

type MemberRow = { id: string; display_name: string; role: string; phone: string | null }
type EntityRow = { id: string; kind: string; name: string; normalized: string | null }
type LinkRow = { id: string; label: string; url: string }

async function loadHouse(db: D1Database, householdId: string) {
  const household = await db
    .prepare("SELECT name FROM households WHERE id = ?")
    .bind(householdId)
    .first<{ name: string }>()
  const members = await db
    .prepare(
      `SELECT id, display_name, role, phone FROM users
       WHERE household_id = ? AND removed_at IS NULL
       ORDER BY display_name`,
    )
    .bind(householdId)
    .all<MemberRow>()
  const links = await db
    .prepare("SELECT id, label, url FROM links WHERE household_id = ? ORDER BY label")
    .bind(householdId)
    .all<LinkRow>()
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
    links: links.results ?? [],
  }
}

function memberRow(member: MemberRow): string {
  const phone = member.phone ? ` · ${escapeHtml(member.phone)}` : ""
  return `<div class="inset"><div class="row"><span>${escapeHtml(member.display_name)}</span><span class="value">${escapeHtml(ROLE_LABEL[member.role] ?? member.role)}${phone}</span></div></div>`
}

function memberForm(member: MemberRow): string {
  const owner = member.role === "owner"
  const role = owner
    ? `<div class="row"><span>Papel</span><span class="value">Dono</span></div>`
    : `<label class="field"><span>Papel</span><select name="role">${roleOptions(member.role)}</select></label>`
  const remove = owner
    ? ""
    : `<button class="destructive" type="submit" name="action" value="remove" formnovalidate data-confirm="Remover ${escapeHtml(member.display_name)} da casa?">Remover</button>`
  return `<form method="post" action="/casa/membros/${escapeHtml(member.id)}">
  <div class="inset">
    <label class="field"><span>Nome</span><input name="displayName" required maxlength="80" value="${escapeHtml(member.display_name)}"></label>
    ${role}
    <label class="field"><span>Telefone</span><input name="phone" maxlength="40" inputmode="tel" autocomplete="tel" value="${escapeHtml(member.phone ?? "")}"></label>
    <button class="link" type="submit" name="action" value="save">Guardar</button>
    ${remove}
  </div>
</form>`
}

function entityRow(entity: { kind: string; name: string; aliases: string[] }): string {
  const alias = entity.aliases.filter((item) => item !== normalizeAlias(entity.name))
  const detail = alias.length > 0 ? `<span class="detail">${alias.map((item) => escapeHtml(item)).join(", ")}</span>` : ""
  return `<div class="inset"><div class="row"><span class="stack"><span>${escapeHtml(entity.name)}</span>${detail}</span><span class="value">${escapeHtml(KIND_LABEL[entity.kind] ?? entity.kind)}</span></div></div>`
}

function entityForm(entity: { id: string; kind: string; name: string; aliases: string[] }): string {
  const alias = entity.aliases.find((item) => item !== normalizeAlias(entity.name)) ?? ""
  return `<form method="post" action="/casa/entidades/${escapeHtml(entity.id)}">
  <div class="inset">
    <label class="field"><span>Tipo</span><select name="kind">${kindOptions(entity.kind)}</select></label>
    <label class="field"><span>Nome</span><input name="name" required maxlength="80" value="${escapeHtml(entity.name)}"></label>
    <label class="field"><span>Outro nome</span><input name="alias" maxlength="80" value="${escapeHtml(alias)}"></label>
    <button class="link" type="submit" name="action" value="save">Guardar</button>
    <button class="destructive" type="submit" name="action" value="remove" formnovalidate data-confirm="Remover ${escapeHtml(entity.name)}?">Remover</button>
  </div>
</form>`
}

function linkRow(link: LinkRow): string {
  return `<div class="inset"><div class="row"><span class="stack"><span>${escapeHtml(link.label)}</span><span class="detail">${escapeHtml(link.url)}</span></span></div></div>`
}

function linkForm(link: LinkRow): string {
  return `<form method="post" action="/casa/links/${escapeHtml(link.id)}">
  <div class="inset">
    <label class="field"><span>Nome</span><input name="label" required maxlength="80" value="${escapeHtml(link.label)}"></label>
    <label class="field"><span>Endereço</span><input name="url" required maxlength="500" inputmode="url" value="${escapeHtml(link.url)}"></label>
    <button class="link" type="submit" name="action" value="save">Guardar</button>
    <button class="destructive" type="submit" name="action" value="remove" formnovalidate data-confirm="Remover este link?">Remover</button>
  </div>
</form>`
}

function kindOptions(selected: string): string {
  return entityKindSchema.options
    .map((kind) => {
      const mark = kind === selected ? " selected" : ""
      return `<option value="${kind}"${mark}>${escapeHtml(KIND_LABEL[kind] ?? kind)}</option>`
    })
    .join("")
}

function roleOptions(selected: string): string {
  return (["adult", "member", "child"] as const)
    .map((role) => {
      const mark = role === selected ? " selected" : ""
      return `<option value="${role}"${mark}>${ROLE_LABEL[role]}</option>`
    })
    .join("")
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

function readId(value: string): string | null {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value)) return null
  return value
}

function readPhone(value: string): string | null | false {
  const phone = value.trim()
  if (!phone) return null
  if (phone.length > 40 || !/^[\d+\s().-]{6,40}$/.test(phone) || !/\d/.test(phone)) return false
  return phone
}

function readUrl(value: string): string | null {
  const raw = value.trim()
  if (raw.length < 8 || raw.length > 500) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.href
  } catch {
    return null
  }
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
