// Mirrors migrations/0001_init.sql. DDL is that file.
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core"

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Lisbon"),
  currency: text("currency").notNull().default("EUR"),
  locale: text("locale").notNull().default("pt-BR"),
  createdAt: text("created_at").notNull(),
})

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    displayName: text("display_name").notNull(),
    role: text("role").$type<"owner" | "adult" | "member" | "child">().notNull(),
    pinHash: text("pin_hash"),
    phone: text("phone"),
    removedAt: text("removed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "users_role_check",
      sql`${table.role} IN ('owner', 'adult', 'member', 'child')`,
    ),
  ],
)

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    kind: text("kind").$type<"personal" | "kiosk">().notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    codeHash: text("code_hash"),
    codeExpiresAt: text("code_expires_at"),
    codeUsedAt: text("code_used_at"),
  },
  (table) => [
    check("devices_kind_check", sql`${table.kind} IN ('personal', 'kiosk')`),
  ],
)

export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  signCount: integer("sign_count").notNull().default(0),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
})

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  role: text("role").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
})

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
})

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    clientMessageId: text("client_message_id").notNull(),
    text: text("text").notNull(),
    source: text("source").$type<"text" | "voice">().notNull(),
    status: text("status").$type<"stored" | "interpreted" | "failed">().notNull(),
    createdAt: text("created_at").notNull(),
    resultJson: text("result_json"),
  },
  (table) => [
    unique("messages_household_client_message").on(
      table.householdId,
      table.clientMessageId,
    ),
    check("messages_source_check", sql`${table.source} IN ('text', 'voice')`),
    check(
      "messages_status_check",
      sql`${table.status} IN ('stored', 'interpreted', 'failed')`,
    ),
  ],
)

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    occurredAt: text("occurred_at").notNull(),
    visibility: text("visibility")
      .$type<"household" | "adults" | "private">()
      .notNull(),
    status: text("status")
      .$type<"active" | "voided" | "superseded">()
      .notNull(),
    version: integer("version").notNull().default(1),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    warrantyEndsOn: text("warranty_ends_on"),
    dataJson: text("data_json").notNull().default("{}"),
    supersedesEventId: text("supersedes_event_id"),
    summary: text("summary").notNull(),
  },
  (table) => [
    check(
      "events_visibility_check",
      sql`${table.visibility} IN ('household', 'adults', 'private')`,
    ),
    check(
      "events_status_check",
      sql`${table.status} IN ('active', 'voided', 'superseded')`,
    ),
    index("events_household_type_time").on(
      table.householdId,
      table.type,
      table.occurredAt,
    ),
    index("events_household_amount_time").on(
      table.householdId,
      table.amountMinor,
      table.occurredAt,
    ),
    index("events_household_status").on(
      table.householdId,
      table.status,
      table.visibility,
    ),
  ],
)

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  dataJson: text("data_json").notNull().default("{}"),
})

export const aliases = sqliteTable(
  "aliases",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    normalized: text("normalized").notNull(),
  },
  (table) => [
    unique("aliases_household_normalized").on(table.householdId, table.normalized),
  ],
)

export const eventEntities = sqliteTable(
  "event_entities",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    entityId: text("entity_id")
      .notNull()
      .references(() => entities.id),
    role: text("role").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.entityId, table.role] }),
  ],
)

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    eventId: text("event_id").references(() => events.id),
    title: text("title").notNull(),
    dueAt: text("due_at").notNull(),
    audience: text("audience").$type<"household" | "adults">().notNull(),
    status: text("status").$type<"open" | "done">().notNull(),
  },
  (table) => [
    check(
      "reminders_audience_check",
      sql`${table.audience} IN ('household', 'adults')`,
    ),
    check("reminders_status_check", sql`${table.status} IN ('open', 'done')`),
    index("reminders_due").on(table.householdId, table.status, table.dueAt),
  ],
)

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  eventId: text("event_id").references(() => events.id),
  r2Key: text("r2_key").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
})

export const embeddingJobs = sqliteTable(
  "embedding_jobs",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => events.id),
    status: text("status").$type<"pending" | "ready" | "failed">().notNull(),
    vectorId: text("vector_id"),
    textHash: text("text_hash"),
  },
  (table) => [
    check(
      "embedding_jobs_status_check",
      sql`${table.status} IN ('pending', 'ready', 'failed')`,
    ),
  ],
)

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    theme: text("theme").$type<"system" | "light" | "dark">().notNull().default("system"),
    accent: text("accent").$type<"teal" | "blue" | "green" | "orange">().notNull().default("teal"),
    speakReplies: integer("speak_replies").notNull().default(0),
    speechRate: real("speech_rate").notNull().default(0.5),
    notifyReminders: integer("notify_reminders").notNull().default(1),
    notifySound: integer("notify_sound").notNull().default(1),
    notifyBadge: integer("notify_badge").notNull().default(1),
    quietStart: text("quiet_start"),
    quietEnd: text("quiet_end"),
  },
  (table) => [
    check("user_preferences_theme_check", sql`${table.theme} IN ('system', 'light', 'dark')`),
    check("user_preferences_accent_check", sql`${table.accent} IN ('teal', 'blue', 'green', 'orange')`),
    check("user_preferences_speak_check", sql`${table.speakReplies} IN (0, 1)`),
    check("user_preferences_rate_check", sql`${table.speechRate} >= 0 AND ${table.speechRate} <= 1`),
    check("user_preferences_reminders_check", sql`${table.notifyReminders} IN (0, 1)`),
    check("user_preferences_sound_check", sql`${table.notifySound} IN (0, 1)`),
    check("user_preferences_badge_check", sql`${table.notifyBadge} IN (0, 1)`),
  ],
)

export const links = sqliteTable("links", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  label: text("label").notNull(),
  url: text("url").notNull(),
  createdAt: text("created_at").notNull(),
})

export const mcpTokens = sqliteTable("mcp_tokens", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
})

export const usage = sqliteTable("usage", {
  id: text("id").primaryKey(),
  traceId: text("trace_id").notNull(),
  messageId: text("message_id"),
  tool: text("tool"),
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
})

// FTS5 virtual table from the migration. Columns only, so reads can target it.
export const eventsFts = sqliteTable("events_fts", {
  eventId: text("event_id"),
  householdId: text("household_id"),
  body: text("body"),
})
