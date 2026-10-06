import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type TestStatement = {
  bind(...values: unknown[]): TestStatement
  run(): Promise<unknown>
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>
  raw<T = unknown>(): Promise<T[][]>
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>
}

export type TestD1 = {
  exec(query: string): Promise<unknown>
  prepare(query: string): TestStatement
  batch(statements: TestStatement[]): Promise<unknown[]>
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

const workerSource = `
export default {
  async fetch(request, env) {
    try {
      const body = await request.json()
      if (body.mode === "exec") {
        await env.DB.exec(body.sql)
        return Response.json({ ok: true })
      }
      const stmt = env.DB.prepare(body.sql).bind(...(body.params ?? []))
      if (body.mode === "first") return Response.json({ row: await stmt.first() })
      if (body.mode === "all") return Response.json(await stmt.all())
      return Response.json(await stmt.run())
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
    }
  }
}
`

type SqlBody = { sql: string; params: unknown[]; mode: "exec" | "all" | "first" | "run" }

async function callSql(
  dispatch: (url: string, init: RequestInit) => Promise<Response>,
  body: SqlBody,
): Promise<Record<string, unknown>> {
  const response = await dispatch("http://d1.test/", {
    method: "POST",
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as Record<string, unknown>
  if (!response.ok) throw new Error(String(payload.error ?? response.status))
  return payload
}

export function splitSql(sql: string): string[] {
  const withoutLineComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
  return withoutLineComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

export async function applyMigration(db: TestD1): Promise<void> {
  const dir = join(root, "migrations")
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
  if (!files.includes("0001_init.sql")) {
    throw new Error("migrations/0001_init.sql em falta (pacote database)")
  }
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8")
    for (const statement of splitSql(sql)) {
      await db.exec(statement)
    }
  }
}

function databaseOver(dispatch: (url: string, init: RequestInit) => Promise<Response>): TestD1 {
  return {
    exec(query) {
      const sql = `${query.replace(/\s+/g, " ").trim().replace(/;+$/, "")};`
      return callSql(dispatch, { sql, params: [], mode: "exec" })
    },
    prepare(query) {
      let params: unknown[] = []
      const statement: TestStatement = {
        bind(...values) {
          params = values
          return statement
        },
        run: () => callSql(dispatch, { sql: query, params, mode: "run" }),
        async all() {
          const payload = await callSql(dispatch, { sql: query, params, mode: "all" })
          return { results: (payload.results as never[]) ?? [] }
        },
        async raw() {
          const payload = await callSql(dispatch, { sql: query, params, mode: "all" })
          const rows = (payload.results as Array<Record<string, unknown>> | undefined) ?? []
          return rows.map((row) => Object.values(row))
        },
        async first() {
          const payload = await callSql(dispatch, { sql: query, params, mode: "first" })
          return (payload.row as never) ?? null
        },
      }
      Object.defineProperty(statement, "sql", { value: query })
      Object.defineProperty(statement, "params", { get: () => params })
      return statement
    },
    async batch(statements) {
      const results = []
      for (const statement of statements) {
        const sql = "sql" in statement ? String(statement.sql) : ""
        const params = "params" in statement && Array.isArray(statement.params) ? statement.params : []
        const payload = await callSql(dispatch, { sql, params, mode: "all" })
        results.push({ results: (payload.results as unknown[]) ?? [], success: true, meta: {} })
      }
      return results
    },
  }
}

async function openMiniflare(): Promise<{ db: TestD1; dispose: () => Promise<void> }> {
  let Miniflare: new (options: Record<string, unknown>) => {
    ready: Promise<unknown>
    dispatchFetch(url: string, init?: RequestInit): Promise<Response>
    dispose(): Promise<void>
  }
  try {
    ;({ Miniflare } = await import("miniflare"))
  } catch {
    throw new Error("miniflare em falta (pacote platform instala wrangler)")
  }

  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: "agentetobias-test",
          compatibilityDate: "2026-10-05",
          manifest: {
            mainModule: "index.mjs",
            modules: {
              "index.mjs": { type: "esm", contents: workerSource },
            },
          },
          env: { DB: { type: "d1" } },
        },
      },
    ],
  })
  await mf.ready
  return {
    db: databaseOver((url, init) => mf.dispatchFetch(url, init)),
    dispose: () => mf.dispose(),
  }
}

export async function withDb<T>(run: (db: TestD1) => Promise<T>): Promise<T> {
  const opened = await openMiniflare()
  try {
    await applyMigration(opened.db)
    return await run(opened.db)
  } finally {
    await opened.dispose()
  }
}

export async function seedHousehold(
  db: TestD1,
  ids: { householdId: string; userId: string; deviceId: string; name: string },
): Promise<void> {
  const now = "2026-10-05T12:00:00.000Z"
  await db
    .prepare(
      "INSERT INTO households (id, name, timezone, currency, locale, created_at) VALUES (?, ?, 'Europe/Lisbon', 'EUR', 'pt-BR', ?)",
    )
    .bind(ids.householdId, ids.name, now)
    .run()
  await db
    .prepare(
      "INSERT INTO users (id, household_id, display_name, role, created_at) VALUES (?, ?, ?, 'owner', ?)",
    )
    .bind(ids.userId, ids.householdId, ids.name, now)
    .run()
  await db
    .prepare(
      "INSERT INTO devices (id, household_id, kind, name, created_at) VALUES (?, ?, 'personal', 'iphone', ?)",
    )
    .bind(ids.deviceId, ids.householdId, now)
    .run()
}

export async function seedVehicle(
  db: TestD1,
  ids: { householdId: string; entityId: string; aliasId: string; name: string; normalized: string },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO entities (id, household_id, kind, name, status, data_json) VALUES (?, ?, 'vehicle', ?, 'active', '{}')",
    )
    .bind(ids.entityId, ids.householdId, ids.name)
    .run()
  await db
    .prepare("INSERT INTO aliases (id, household_id, entity_id, normalized) VALUES (?, ?, ?, ?)")
    .bind(ids.aliasId, ids.householdId, ids.entityId, ids.normalized)
    .run()
}

export async function seedExpense(
  db: TestD1,
  ids: {
    householdId: string
    userId: string
    eventId: string
    amountMinor: number
    occurredAt: string
  },
): Promise<void> {
  const now = "2026-10-05T12:00:00.000Z"
  const conversationId = crypto.randomUUID()
  const messageId = crypto.randomUUID()
  await db
    .prepare(
      "INSERT INTO conversations (id, household_id, user_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(conversationId, ids.householdId, ids.userId, now)
    .run()
  await db
    .prepare(
      "INSERT INTO messages (id, household_id, actor_id, conversation_id, client_message_id, text, source, status, created_at) VALUES (?, ?, ?, ?, ?, 'despesa semeada', 'text', 'interpreted', ?)",
    )
    .bind(messageId, ids.householdId, ids.userId, conversationId, crypto.randomUUID(), now)
    .run()
  await db
    .prepare(
      "INSERT INTO events (id, household_id, message_id, actor_id, type, occurred_at, visibility, status, version, amount_minor, currency, data_json, summary) VALUES (?, ?, ?, ?, 'expense', ?, 'household', 'active', 1, ?, 'EUR', '{}', ?)",
    )
    .bind(
      ids.eventId,
      ids.householdId,
      messageId,
      ids.userId,
      ids.occurredAt,
      ids.amountMinor,
      `€${ids.amountMinor / 100}`,
    )
    .run()
}

export async function listEvents(
  db: TestD1,
  householdId: string,
): Promise<Array<{ id: string; type: string; status: string; amount_minor: number | null; currency: string | null; visibility: string }>> {
  const result = await db
    .prepare(
      "SELECT id, type, status, amount_minor, currency, visibility FROM events WHERE household_id = ?",
    )
    .bind(householdId)
    .all<{ id: string; type: string; status: string; amount_minor: number | null; currency: string | null; visibility: string }>()
  return result.results ?? []
}
