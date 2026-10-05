# Contrato partilhado

Este ficheiro é a interface entre pacotes. Um agent que precise de um campo que não está aqui para e regista a falta. Não o inventa no código.

Host: `https://tobias.timdevops.com.br`. A PWA e a API são a mesma origem. Não há CORS para outros origins.

## Bindings e variáveis

| Nome | Tipo | Valor |
| --- | --- | --- |
| `DB` | D1 | base `agentetobias`, id `0ce884cc-676a-4a4b-8b37-3ded77968528` |
| `FILES` | R2 | bucket `agentetobias-files` |
| `VECTORS` | Vectorize | índice `agentetobias-events`, 1024, cosine |
| `AI` | Workers AI | — |
| `AI_GATEWAY_ID` | var | `agentetobias` |
| `AI_INTERPRET_MODEL` | var | `@cf/qwen/qwen3-30b-a3b-fp8` |
| `AI_STT_MODEL` | var | `@cf/openai/whisper-large-v3-turbo` |
| `AI_EMBED_MODEL` | var | `@cf/baai/bge-m3` |
| `EMBEDDINGS` | var | `"0"` no corte 1, `"1"` no corte 2 |
| `BOOTSTRAP_TOKEN` | secret | só no Worker |
| `PIN_PEPPER` | secret | só no Worker |

Chamadas ao Workers AI passam pelo gateway:

```ts
env.AI.run(model, inputs, { gateway: { id: env.AI_GATEWAY_ID } })
```

## Tipos

Ficheiro único: `src/domain/types.ts`. Os outros pacotes importam daqui.

```ts
export type Role = "owner" | "adult" | "member" | "child"
export type Visibility = "household" | "adults" | "private"
export type EventStatus = "active" | "voided" | "superseded"
export type EventType =
  | "expense"
  | "purchase"
  | "vehicle.fuel"
  | "vehicle.maintenance"
  | "warranty"
  | "object.location"
  | "note"
  | "incident"
  | "reminder"

export type Session = {
  userId: string
  householdId: string
  role: Role
  deviceId: string
}

export type Money = { amountMinor: number; currency: "EUR" }

export type EventSummary = {
  id: string
  type: EventType
  occurredAt: string
  amountMinor: number | null
  currency: string | null
  summary: string
  warrantyEndsOn: string | null
}

export type MessageResponse = {
  messageId: string
  conversationId: string
  status: "interpreted" | "stored" | "clarification"
  reply: string
  events: EventSummary[]
  clarification: { question: string } | null
  idempotent: boolean
}
```

Ids são UUID v4. `occurredAt` e `dueAt` são ISO 8601 em UTC. O dia civil mostra-se em `Europe/Lisbon`.

## Erros

HTTP e corpo, sempre:

```json
{ "error": { "code": "unauthorized", "message": "Sessão em falta." } }
```

| Código | HTTP | Quando |
| --- | --- | --- |
| `unauthorized` | 401 | Sem sessão |
| `forbidden` | 403 | Papel insuficiente. Não usar para dizer que o id existe noutro household |
| `not_found` | 404 | Id deste household não existe, ou existe noutro household |
| `validation` | 400 | JSON ou schema inválido |
| `conflict` | 409 | Só para convite já usado. Idempotência de mensagem não é 409 |
| `unavailable` | 503 | Modelo e fallback em baixo. A mensagem, se já foi gravada, vem na resposta 200 com `status: "stored"` em vez deste erro |

`message` é uma frase curta em português, segura para mostrar. Sem stack, sem SQL, sem texto de outro household.

## Sessão

Cookie `tobias_session`. Valor: id opaco da linha `sessions`. Atributos: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (30 dias) em dispositivo pessoal. No kiosk, `Max-Age=900` (15 minutos).

`GET /api/me` com sessão:

```json
{
  "user": { "id": "…", "displayName": "Renato", "role": "owner" },
  "household": { "id": "…", "name": "Casa", "timezone": "Europe/Lisbon", "currency": "EUR", "locale": "pt-PT" }
}
```

## Rotas

Todas sob `/api`. Fora de `/api`, o Worker serve a PWA.

### Auth

| Método | Rota | Sessão | Corte |
| --- | --- | --- | --- |
| POST | `/api/bootstrap` | não | 1 |
| POST | `/api/auth/register/options` | não | 1 |
| POST | `/api/auth/register` | não | 1 |
| POST | `/api/auth/login/options` | não | 1 |
| POST | `/api/auth/login` | não | 1 |
| POST | `/api/auth/logout` | sim | 1 |
| GET | `/api/me` | sim | 1 |
| POST | `/api/invites` | owner | 2 |
| POST | `/api/kiosk/unlock` | dispositivo kiosk já registado | 2 |

`POST /api/bootstrap` só funciona se `households` estiver vazia e o campo `token` for igual a `BOOTSTRAP_TOKEN`.

```json
{ "token": "…", "displayName": "Renato", "householdName": "Casa" }
```

A resposta inclui os options WebAuthn para o owner registar a passkey no passo seguinte. O household e o user `owner` ficam criados antes da passkey. Se a passkey não terminar, um segundo bootstrap falha porque já há household: o owner usa o invite ou repete o register com a sessão de bootstrap. A resposta de bootstrap põe o cookie.

Detalhe da cerimónia WebAuthn: [04-auth.md](04-auth.md).

### Mensagens

`POST /api/messages` — corte 1.

```json
{
  "clientMessageId": "uuid",
  "text": "abasteci o i30 70 euros",
  "conversationId": "uuid ou omitido",
  "correctsEventId": "uuid ou omitido"
}
```

Resposta: `MessageResponse`.

Repetir o mesmo `clientMessageId` no mesmo household devolve a resposta guardada, `idempotent: true`, sem segunda chamada ao modelo.

`correctsEventId` marca o evento anterior `superseded` e liga o novo. Só se o evento for deste household e `active`.

`status: "stored"` significa texto guardado e interpretação adiada. `reply` é `Guardado, ainda por interpretar.`

`status: "clarification"` não cria evento. `reply` é a única pergunta.

### Eventos

`POST /api/events/:id/void` — corte 1. Sessão do ator ou de um `owner`/`adult`. Evento `private` só pelo autor ou pelo owner. Resposta:

```json
{ "id": "…", "status": "voided" }
```

### Lembretes

`GET /api/reminders?status=open` — corte 2.

```json
{
  "reminders": [
    {
      "id": "…",
      "title": "Garantia da air fryer",
      "dueAt": "2028-09-05T00:00:00.000Z",
      "audience": "adults",
      "eventId": "…"
    }
  ]
}
```

`child` não recebe `audience: "adults"`. Ordenação: `due_at` ascendente. `status=open` é o default.

### Voz

`POST /api/speech` — corte 2. `multipart/form-data` com o campo `audio` (`audio/mp4`, até 60 s, até 8 MB) e o campo `clientMessageId`.

```json
{ "clientMessageId": "…", "transcript": "abasteci o i30 setenta euros" }
```

Não grava mensagem nem evento. O cliente mostra o texto e chama `POST /api/messages`.

### Ficheiros

`POST /api/files` — corte 2. Multipart, campo `file`. JPEG, PNG, WebP ou PDF. Até 10 MB.

```json
{ "fileId": "…", "mime": "image/jpeg", "bytes": 120034 }
```

`GET /api/files/:id/url` devolve `{ "url": "…", "expiresAt": "…" }`. A URL dura 5 minutos. O objeto não é público.

## Tabelas

O SQL completo está em [03-database.md](03-database.md). Nomes e colunas que o resto do código pode usar:

- `households`: `id`, `name`, `timezone`, `currency`, `locale`, `created_at`
- `users`: `id`, `household_id`, `display_name`, `role`, `pin_hash`, `created_at`
- `devices`: `id`, `household_id`, `kind` (`personal` \| `kiosk`), `name`, `created_at`
- `passkeys`: `id`, `user_id`, `credential_id`, `public_key`, `sign_count`
- `sessions`: `id`, `user_id`, `device_id`, `expires_at`, `revoked_at`
- `invites`: `id`, `household_id`, `role`, `code_hash`, `expires_at`, `used_at`
- `conversations`: `id`, `household_id`, `user_id`, `created_at`
- `messages`: `id`, `household_id`, `actor_id`, `conversation_id`, `client_message_id`, `text`, `source` (`text` \| `voice`), `status` (`stored` \| `interpreted` \| `failed`), `created_at`, `result_json`
- `events`: `id`, `household_id`, `message_id`, `actor_id`, `type`, `occurred_at`, `visibility`, `status`, `version`, `amount_minor`, `currency`, `warranty_ends_on`, `data_json`, `supersedes_event_id`, `summary`
- `entities`: `id`, `household_id`, `kind`, `name`, `status`, `data_json`
- `aliases`: `id`, `household_id`, `entity_id`, `normalized`
- `event_entities`: `event_id`, `entity_id`, `role`
- `reminders`: `id`, `household_id`, `event_id`, `title`, `due_at`, `audience`, `status`
- `files`: `id`, `household_id`, `event_id`, `r2_key`, `mime`, `bytes`, `sha256`, `created_by`
- `embedding_jobs`: `event_id`, `status` (`pending` \| `ready` \| `failed`), `vector_id`, `text_hash`
- `usage`: `id`, `trace_id`, `message_id`, `tool`, `model`, `tokens_in`, `tokens_out`, `latency_ms`, `error_code`, `created_at`

Único: `messages (household_id, client_message_id)` e `aliases (household_id, normalized)`.

`result_json` em `messages` guarda o `MessageResponse` da primeira interpretação, para o retry idempotente.

## Tools do modelo

O modelo só pode pedir estas tools. Os schemas Zod vivem em `src/domain/tools.ts`.

| Tool | Campos obrigatórios | Efeito |
| --- | --- | --- |
| `record_event` | `type`, `occurredAt`, `visibility` | Cria evento se o schema do tipo passar |
| `resolve_or_create_entity` | `kind`, `name` | Devolve id existente se o alias normalizado já existe |
| `ask_clarification` | `question` | Zero escritas |
| `search_events` | nenhum, filtros opcionais | Lê. Não chama outro modelo |
| `search_text` | `query` | FTS e, se `EMBEDDINGS=1`, vetores |
| `void_event` | `eventId` | Anula |
| `create_reminder` | `title`, `dueAt`, `audience` | Cria lembrete |
| `attach_file` | `fileId` | Liga um ficheiro já enviado |

`record_event` por tipo:

| type | Obrigatório em `data` | Opcional, pode faltar |
| --- | --- | --- |
| `expense` | `amountMinor`, `currency` | merchant, note |
| `purchase` | nenhum | `amountMinor`, `currency`, product |
| `vehicle.fuel` | `entityId` de um veículo | litros, km, posto, `amountMinor` |
| `vehicle.maintenance` | `entityId` de um veículo | `amountMinor`, note |
| `warranty` | `warrantyMonths` (inteiro), `entityId` | `amountMinor` |
| `object.location` | `entityId`, `place` | note |
| `note` | `text` | — |
| `incident` | `text` | — |
| `reminder` | `title`, `dueAt` | — |

`currency`, quando vem, é `EUR`. Outra moeda é `validation` e vira pergunta, não gravação.

`warrantyEndsOn` é calculado em `src/domain/warranty.ts` com calendário de Lisboa: data de compra mais `warrantyMonths`. O modelo não envia a data de fim.

Visibilidade por defeito: `household`. `child` não pode criar `adults` nem `private` de outra pessoa. `private` fica com o ator.

## Funções que os pacotes exportam

```ts
// src/application/auth/session.ts
export function readSession(db: D1Database, cookieHeader: string | null, now: Date): Promise<Session | null>

// src/application/agent/handleMessage.ts
export function handleMessage(env: Env, session: Session, input: MessageInput, now: Date): Promise<MessageResponse>

// src/application/search/searchEvents.ts
export function searchEvents(db: D1Database, session: Session, filter: EventFilter): Promise<EventSummary[]>

// src/infrastructure/ai/stt.ts
export function transcribe(env: Env, audio: ArrayBuffer, mime: string): Promise<string>

// src/infrastructure/search.ts
export function canonicalText(event: { summary: string; type: string; occurredAt: string }): string
export function embedPending(env: Env, limit: number): Promise<number>

// src/http/routes/*.ts
export function registerAuth(app: Hono<AppEnv>): void
export function registerMessages(app: Hono<AppEnv>): void
export function registerEvents(app: Hono<AppEnv>): void
export function registerReminders(app: Hono<AppEnv>): void
export function registerSpeech(app: Hono<AppEnv>): void
export function registerFiles(app: Hono<AppEnv>): void
```

`Env` está definido em `src/env.ts` (pacote platform) com os bindings deste contrato.

## Dependências

O pacote platform instala, e mais ninguém mexe no `package.json`:

- `hono`, `zod`, `drizzle-orm`
- `react`, `react-dom`, `vite`
- `wrangler`, `typescript`
- `@simplewebauthn/server`, `@simplewebauthn/browser`
- `vitest` em devDependencies

Sem biblioteca de UI. Sem ORM além de Drizzle. Sem cliente HTTP no browser além de `fetch`.

## Frases de confirmação

O pacote domain monta `summary` e `reply` em código, a partir do evento gravado, não a partir do texto livre do modelo.

| Situação | reply |
| --- | --- |
| Despesa | `Registrei €80 no Continente.` |
| Combustível | `Registrei €70 de combustível no i30.` |
| Compra com garantia | `Registrei a air fryer, garantia até 5 de outubro de 2028.` |
| Clarificação de veículo | `Foi o i30 ou o Aveo?` |
| Modelo em baixo | `Guardado, ainda por interpretar.` |
| Soma | `€80 este mês.` — o número vem do SQL |
| Soma vazia | `Não há despesas do Continente este mês.` |

Formato de dinheiro em pt-PT: `€` e vírgula decimal (`€70,50`). O inteiro interno continua em cêntimos.
