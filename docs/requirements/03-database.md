# Pacote database

Dono de `migrations/0001_init.sql` e de `src/infrastructure/d1/schema.ts` (Drizzle a espelhar o SQL). Não escreve regras de negócio. Não chama o modelo.

A base remota já existe: `agentetobias`, id `0ce884cc-676a-4a4b-8b37-3ded77968528`, jurisdição `eu`. A migration aplica-se primeiro no D1 local do Wrangler. Não aplicar em produção sem pedido.

## SQL

```sql
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon',
  currency TEXT NOT NULL DEFAULT 'EUR',
  locale TEXT NOT NULL DEFAULT 'pt-PT',
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'adult', 'member', 'child')),
  pin_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'kiosk')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  role TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  client_message_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('text', 'voice')),
  status TEXT NOT NULL CHECK (status IN ('stored', 'interpreted', 'failed')),
  created_at TEXT NOT NULL,
  result_json TEXT,
  UNIQUE (household_id, client_message_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('household', 'adults', 'private')),
  status TEXT NOT NULL CHECK (status IN ('active', 'voided', 'superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  amount_minor INTEGER,
  currency TEXT,
  warranty_ends_on TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  supersedes_event_id TEXT,
  summary TEXT NOT NULL
);

CREATE INDEX events_household_type_time ON events (household_id, type, occurred_at);
CREATE INDEX events_household_amount_time ON events (household_id, amount_minor, occurred_at);
CREATE INDEX events_household_status ON events (household_id, status, visibility);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE aliases (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  normalized TEXT NOT NULL,
  UNIQUE (household_id, normalized)
);

CREATE TABLE event_entities (
  event_id TEXT NOT NULL REFERENCES events(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  role TEXT NOT NULL,
  PRIMARY KEY (event_id, entity_id, role)
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  event_id TEXT REFERENCES events(id),
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('household', 'adults')),
  status TEXT NOT NULL CHECK (status IN ('open', 'done'))
);

CREATE INDEX reminders_due ON reminders (household_id, status, due_at);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  event_id TEXT REFERENCES events(id),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE embedding_jobs (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  vector_id TEXT,
  text_hash TEXT
);

CREATE TABLE usage (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  message_id TEXT,
  tool TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE events_fts USING fts5(
  event_id UNINDEXED,
  household_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 1'
);
```

O FTS não recebe o household como filtro de relevância: a query de leitura filtra `household_id` no `WHERE`, depois do `MATCH`. Ao anular um evento, apagar a linha do FTS com o mesmo `event_id`.

`usage` não tem colunas de texto livre. Não acrescentar `prompt` nem `transcript`.

## Drizzle

`src/infrastructure/d1/schema.ts` declara as mesmas tabelas e exporta os objetos Drizzle. `src/infrastructure/d1/client.ts` exporta `dbFrom(env.DB)`.

Queries prontas, ainda sem regra de produto, em `src/infrastructure/d1/queries.ts`:

- `insertMessage` que respeita o único e devolve a linha existente se o `client_message_id` já estiver lá.
- `sumAmount(householdId, type, entityId | null, from, to, visibilityClause)`.
- `listReminders(householdId, audienceAllowed, status)`.

A cláusula de visibilidade é um argumento já decidido por `src/domain/access.ts`. Esta camada não reimplementa papéis.

## Aceitação

- A migration aplica num D1 vazio local sem erro.
- Inserir duas mensagens com o mesmo `(household_id, client_message_id)` falha na segunda.
- Dois aliases `Continente` e `continente` no mesmo household não cabem os dois, porque o único é o valor já normalizado. Quem normaliza é o domain, antes do insert. O teste insere `continente` duas vezes e espera falha.
