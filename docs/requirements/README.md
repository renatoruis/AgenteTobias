# Requisitos — trabalho em paralelo

O alvo da família é uma app iOS no TestFlight, em conversa com `https://tobias.timdevops.com.br`, com chat, botão push-to-talk, lembretes e definições. A API é um Cloudflare Worker. O contrato comum está em [00-contract.md](00-contract.md). A conta está em [../CLOUDFLARE.md](../CLOUDFLARE.md).

Há dois cortes. Os dois usam os mesmos tipos e as mesmas rotas. O corte 2 acrescenta comportamento, não uma API nova.

| Corte | O que a família consegue fazer | Pronto quando |
| --- | --- | --- |
| 1 — Prototype | Entrar com passkey, escrever uma despesa ou um abastecimento, receber a confirmação, desfazer, perguntar a soma do mês | Os testes de `tests/unit` e o fluxo A e B do contrato passam em local |
| 2 — MVP | Segurar o botão e falar, ver a transcrição, corrigir, ter lembretes no ecrã, anexar foto ou PDF, aliases | Os fluxos C, D e G passam, e `GET /api/reminders` lista o que a conversa criou |

Busca semântica (Vectorize) fica ligada no corte 2, atrás da flag `EMBEDDINGS`. Se o índice falhar, o registo grava na mesma.

## Pacotes

Cada linha é um agent. Trabalham ao mesmo tempo. Só editam a coluna “Dono”.

| Pacote | Documento | Dono de |
| --- | --- | --- |
| platform | [01-platform.md](01-platform.md) | `package.json`, `tsconfig.json`, `wrangler.jsonc`, `src/env.ts`, `src/http/index.ts`, `src/http/app.ts` |
| domain | [02-domain.md](02-domain.md) | `src/domain/**` |
| database | [03-database.md](03-database.md) | `migrations/**`, `src/infrastructure/d1/**` |
| auth | [04-auth.md](04-auth.md) | `src/application/auth/**`, `src/http/routes/auth.ts` |
| agent | [05-agent.md](05-agent.md) | `src/application/agent/**`, `src/http/routes/messages.ts`, `src/http/routes/reminders.ts`, `src/http/routes/events.ts` |
| speech | [06-speech.md](06-speech.md) | `src/infrastructure/ai/stt.ts`, `src/http/routes/speech.ts` |
| files | [07-files.md](07-files.md) | `src/infrastructure/r2.ts`, `src/http/routes/files.ts` |
| search | [08-search.md](08-search.md) | `src/infrastructure/search.ts`, `src/application/search/**` |
| client | [09-client.md](09-client.md) | `ios/**` |
| tests | [10-tests.md](10-tests.md) | `tests/**` |

`src/http/index.ts` monta as rotas chamando `registerAuth`, `registerMessages`, `registerReminders`, `registerEvents`, `registerSpeech`, `registerFiles`. Cada pacote exporta a sua função de registo. O pacote platform importa-as. Se o ficheiro ainda não existir, o platform deixa a importação no sítio certo e não reimplementa a rota.

Ninguém edita `docs/ARCHITECTURE.md` para “alinhar com o código”. Uma decisão nova é um ADR em `docs/adr/`.

## Regras para não colidir

- Nomes de rotas, colunas, bindings e tipos: só os do contrato.
- `household_id` vem da sessão, nunca do JSON do cliente nem do modelo.
- Dinheiro é inteiro em cêntimos. Datas de negócio resolvem-se em `Europe/Lisbon`.
- O modelo não escreve SQL e não escolhe o household.
- Idempotência: `(household_id, client_message_id)` único. O segundo POST devolve o mesmo resultado e não chama o modelo.
- Texto da família não vai para logs nem para o AI Gateway. O gateway já está com `collect_logs: false`.
- Dependências novas: pedir no pacote platform, não espalhar `package.json`. A lista inicial está no contrato.
- Testes de domínio e de dinheiro vivem em `tests/unit` e importam `src/domain`. O pacote tests escreve-os. O pacote domain não cria uma segunda suite.

## Ordem de integração

Os pacotes não esperam uns pelos outros para escrever ficheiros. A integração, feita por uma pessoa ou por um agent só no fim, é:

1. platform instala e sobe `wrangler dev`.
2. database aplica a migration no D1 local.
3. auth cria o primeiro owner com `BOOTSTRAP_TOKEN`.
4. agent + domain fazem o fluxo de texto.
5. client é a app iOS, contra essas rotas.
6. speech, files, reminders e search entram sem mudar o JSON já publicado.

## Fora de todos os pacotes

OCR, Open Banking, geocoder, segundo modelo em série, Cloudflare Access, Google login, monorepo. A app pública na App Store fica para depois do TestFlight.
