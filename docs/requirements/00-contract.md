# Contrato partilhado

Este ficheiro é a interface entre pacotes. Um agent que precise de um campo que não está aqui para e regista a falta. Não o inventa no código.

Host: `https://tobias.timdevops.com.br`. A app iOS fala com este host. Não há CORS para outros origins.

## Bindings e variáveis

| Nome | Tipo | Valor |
| --- | --- | --- |
| `DB` | D1 | base `agentetobias`, id `0ce884cc-676a-4a4b-8b37-3ded77968528` |
| `FILES` | R2 | bucket `agentetobias-files` |
| `VECTORS` | Vectorize | índice `agentetobias-events`, 1024, cosine |
| `AI` | Workers AI | — |
| `AI_GATEWAY_ID` | var | `agentetobias` |
| `AI_INTERPRET_MODEL` | var | `openai/gpt-5-mini` (modelo de terceiros pelo binding `AI`, Unified Billing) |
| `AI_FALLBACK_MODEL` | var | `google-ai-studio/gemini-2.5-flash-lite`. Uma tentativa se o principal falhar. Vazio desliga o fallback |
| `AI_STT_MODEL` | var | `@cf/openai/whisper-large-v3-turbo` |
| `AI_EMBED_MODEL` | var | `@cf/baai/bge-m3` |
| `EMBEDDINGS` | var | `"0"`. Vectorize desligado até haver uma pergunta real que o FTS não encontre |
| `CONFIRM_ABOVE_MINOR` | var | `"50000"`. Acima disto `remember` propõe em vez de gravar |
| `BOOTSTRAP_TOKEN` | secret | só no Worker |
| `PIN_PEPPER` | secret | só no Worker |

Chamadas a modelos, Cloudflare ou de terceiros, passam pelo gateway com o mesmo binding:

```ts
env.AI.run(model, inputs, { gateway: { id: env.AI_GATEWAY_ID } })
```

Modelos `author/model` (sem `@cf/`) são de terceiros e pagam-se pelo crédito Unified Billing do gateway. Nenhuma chave de provedor entra no Worker.

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
  | "income"

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
  status: "interpreted" | "stored" | "proposal"
  reply: string
  events: EventSummary[]
  idempotent: boolean
}
```

`events` lista os eventos que esta mensagem gravou ou anulou. Uma pergunta do Tobias é `interpreted` com `events: []`.

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

Todas sob `/api`. `GET /` responde uma página estática curta. `GET /.well-known/apple-app-site-association` publica a associação da app. O resto fora de `/api` é 404.

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
| PATCH | `/api/me` | sim | 1 |
| GET | `/api/users` | sim | 1 |
| GET | `/api/me/preferences` | sim | 1 |
| PUT | `/api/me/preferences` | sim | 1 |
| GET | `/api/sessions` | sim | 1 |
| POST | `/api/sessions/:id/revoke` | sim | 1 |
| PUT | `/api/devices/current/push` | sim | 1 |
| PATCH | `/api/household` | owner | 1 |
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

`status: "interpreted"` é o caso normal: o Tobias respondeu. `reply` é texto do modelo. Se gravou, `events` traz o que gravou e a app mostra Desfazer e Editar. Se perguntou, `events` vem vazio.

`status: "stored"` significa que o modelo principal e o fallback falharam. O texto fica guardado. `reply` é `Guardado, ainda por interpretar.`

`status: "proposal"` não cria evento. Só acontece quando o valor passa `CONFIRM_ABOVE_MINOR`. `reply` é «Entendi: …. Gravo?». O rascunho fica em `result_json` e não volta no JSON da resposta.

`POST /api/messages/:id/confirm` — corte 1. Corpo `{ "accept": true | false }`. `true` grava o rascunho e devolve `interpreted`. `false` devolve `Não gravei.` Sem segunda chamada ao modelo. O cliente não reenvia o rascunho.

Uma frase seguinte «sim», «grava», «não» ou «deixa», com proposta aberta na mesma conversa, faz o mesmo sem modelo. Outra frase descarta o rascunho e interpreta-se à parte.

Perguntas de data e hora («que dia é hoje», «que dia da semana», «que horas são», «que data é hoje») respondem em código, `Europe/Lisbon`, sem modelo e sem proposta.

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

`POST /api/reminders/:id/done` — marca `done` se o lembrete está `open` e a sessão o pode ver. Resposta `{ "id", "status": "done" }`. Se não estiver visível, 404.

### Conta, preferências e avisos

`PATCH /api/me` com `{ "displayName" }` devolve o corpo de `GET /api/me`.

`PATCH /api/household` com `{ "name" }`, só owner, devolve o objeto `household` de `GET /api/me`.

`GET /api/users`:

```json
{ "users": [{ "id": "…", "displayName": "Renato", "role": "owner" }] }
```

`GET /api/me/preferences` e `PUT /api/me/preferences`. O PUT substitui o documento inteiro. Sem linha gravada, o GET devolve estes defaults:

```json
{
  "appearance": { "theme": "system", "accent": "teal" },
  "voice": { "speakReplies": false, "rate": 0.5 },
  "notifications": { "reminders": true, "sound": true, "badge": true, "quietHours": null }
}
```

`theme`: `system` | `light` | `dark`. `accent`: `teal` | `blue` | `green` | `orange`. `rate`: número de 0 a 1. `quietHours`: `null` ou `{ "start": "22:00", "end": "08:00" }` em `HH:mm`, horas diferentes.

`GET /api/sessions`:

```json
{ "sessions": [{ "id": "…", "deviceName": "telemóvel", "current": true }] }
```

O owner vê as sessões ativas da casa. Os outros vêem as suas. `POST /api/sessions/:id/revoke` responde 204. A pessoa revoga as suas. O owner revoga qualquer uma da casa. Outra casa, ou já revogada: 404.

`PUT /api/devices/current/push` com `{ "token", "environment": "sandbox" | "production" }`. `token` é o device token APNs em hexadecimal, 64 caracteres. Resposta 204. O aparelho é o `device_id` da sessão.

### Voz

`POST /api/speech` — corte 2. `multipart/form-data` com o campo `audio` (`audio/mp4`, até 60 s, até 8 MB) e o campo `clientMessageId`.

```json
{ "clientMessageId": "…", "transcript": "abasteci o i30 setenta euros" }
```

Não grava mensagem nem evento. O cliente mostra o texto e chama `POST /api/messages`.

### Ficheiros

`POST /api/files` — corte 2. Multipart, campo `file`. JPEG, PNG, WebP ou PDF. Até 10 MB. Campo opcional `conversationId`: liga o ficheiro ao evento activo mais recente dessa conversa.

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
- `user_preferences`: `user_id`, `theme`, `accent`, `speak_replies`, `speech_rate`, `notify_reminders`, `notify_sound`, `notify_badge`, `quiet_start`, `quiet_end`
- `push_tokens`: `id`, `device_id`, `user_id`, `token`, `environment` (`sandbox` | `production`), `updated_at`
- `reminder_deliveries`: `reminder_id`, `user_id`, `sent_at`
- `files`: `id`, `household_id`, `event_id`, `r2_key`, `mime`, `bytes`, `sha256`, `created_by`
- `embedding_jobs`: `event_id`, `status` (`pending` \| `ready` \| `failed`), `vector_id`, `text_hash`
- `usage`: `id`, `trace_id`, `message_id`, `tool`, `model`, `tokens_in`, `tokens_out`, `latency_ms`, `error_code`, `created_at`

Único: `messages (household_id, client_message_id)`, `aliases (household_id, normalized)`, `push_tokens (device_id, user_id)` e `reminder_deliveries (reminder_id, user_id)`.

`result_json` em `messages` guarda o `MessageResponse` da primeira interpretação, para o retry idempotente.

## Tools do modelo

O modelo só pode pedir estas tools. Os schemas Zod vivem em `src/domain/tools.ts`. `householdId` e `actorId` vêm da sessão; qualquer valor que o modelo mande é descartado. O resultado de cada tool volta ao modelo como JSON; o modelo escreve a frase final.

| Tool | Campos | Efeito |
| --- | --- | --- |
| `remember` | `text`, `type`; opcionais `occurredAt`, `amountMinor`, `entities[]` (`name`, `kind`), `visibility`, `remindAt`, `warrantyMonths`, `place`, `details` | Grava um evento. Acima de `CONFIRM_ABOVE_MINOR` devolve proposta em vez de gravar |
| `recall` | opcionais `query`, `type`, `entity`, `from`, `to`, `limit` | Lê. FTS5 sobre o texto mais filtros. Até 12 linhas |
| `total` | opcionais `type` (default `expense`), `entity`, `from`, `to` (default mês civil corrente) | `SUM(amount_minor)` em SQL dos eventos `active` visíveis |
| `amend` | `eventId` mais os campos de `remember` a alterar | Nova versão; o anterior fica `superseded` |
| `void` | `eventId` | Anula |

Regras de `remember` por tipo, verificadas no servidor:

| type | Obrigatório | Nota |
| --- | --- | --- |
| `expense` | `amountMinor` | entidade `merchant` se vier |
| `income` | `amountMinor` | venda, salário, reembolso; `text` diz o quê |
| `purchase` | — | `warrantyMonths` cria garantia e lembrete |
| `vehicle.fuel`, `vehicle.maintenance` | um veículo | sem `entities`: se a casa tem um veículo usa-o; com dois ou mais a tool devolve `ambiguous_vehicle` com os nomes |
| `warranty` | `warrantyMonths`, uma entidade | |
| `object.location` | `place`, uma entidade | |
| `note`, `incident` | `text` | |
| `reminder` | `remindAt` | `text` é o título |

`amountMinor` aceita inteiro em cêntimos ou texto (`"80 euros"`, `"70,50"`) que passa por `parseEur`. Outra moeda é erro de validação. `occurredAt` e `remindAt` aceitam `hoje`, `ontem`, `sábado`, ou ISO 8601. `warrantyEndsOn` é calculado em `src/domain/warranty.ts`.

Um erro de tool devolve `{ "error": "<código>", ... }` ao modelo, nunca grava, e o modelo pergunta em texto. Códigos: `validation`, `missing_amount`, `ambiguous_vehicle`, `no_vehicle`, `missing_place`, `missing_months`, `not_found`, `forbidden`.

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
- `wrangler`, `typescript`
- `@simplewebauthn/server`
- `vitest` em devDependencies

Sem biblioteca de UI no Worker. Sem ORM além de Drizzle. A app iOS não acrescenta dependências a este `package.json`.

## Frases de confirmação

A frase que a família lê é do modelo, em português, na variante de quem fala, curta. As frases abaixo são o que o código produz sem modelo:

| Situação | reply |
| --- | --- |
| Proposta acima do limiar | `Entendi: €600 no Numa X Piano 73. Gravo?` |
| Confirmação pelo botão ou «sim» | `Registrei €600 no Numa X Piano 73.` (de `reply.ts`) |
| «não» ou botão Não | `Não gravei.` |
| Data | `Hoje é segunda-feira, 5 de outubro de 2026.` |
| Principal e fallback em baixo | `Guardado, ainda por interpretar.` |

Formato de dinheiro em pt-PT: `€` e vírgula decimal (`€70,50`). O inteiro interno continua em cêntimos. `summary` de cada evento é montado em código a partir dos campos gravados, não do texto livre do modelo.
