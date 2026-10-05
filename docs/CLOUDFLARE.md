# Cloudflare — AgenteTobias

Confirmado em 5 de outubro de 2026 pelo MCP Cloudflare. A sessão consegue ler e criar Workers, D1, R2, Vectorize, AI Gateway, Workers AI e DNS nesta conta.

## Conta e zona

| | |
| --- | --- |
| Conta | `Renatoruis@gmail.com's Account` |
| Account ID | `6a4b8e5b2ac1dcea60835a6c12208dac` |
| Zona | `timdevops.com.br` |
| Zone ID | `44c509011ee591a5607021683001f93b` |
| Plano da zona | Free Website |
| Host da app | `tobias.timdevops.com.br` |
| URL | `https://tobias.timdevops.com.br` |

O registo DNS de `tobias` ainda não existe. Não criar um A/CNAME à mão. O Worker, com custom domain, cria o registo ao publicar.

## Recursos deste projeto

Já criados. Não criar segundos com outro nome.

| Recurso | Nome | Binding no Worker | Notas |
| --- | --- | --- | --- |
| D1 | `agentetobias` | `DB` | UUID `0ce884cc-676a-4a4b-8b37-3ded77968528`. Jurisdição `eu`. Região primária `EEUR`. 0 tabelas. |
| R2 | `agentetobias-files` | `FILES` | Localização `WEUR`. Standard. Privado. |
| Vectorize | `agentetobias-events` | `VECTORS` | 1024 dimensões, métrica `cosine`. Medido com `@cf/baai/bge-m3` (`shape [1, 1024]`, pooling `cls`). |
| AI Gateway | `agentetobias` | variável `AI_GATEWAY_ID` | `collect_logs: false`, `zdr: true`, cache TTL 0, 120 pedidos / 60 s. |
| Workers AI | binding `AI` | `AI` | Modelos visíveis na conta: `@cf/qwen/qwen3-30b-a3b-fp8`, `@cf/openai/whisper-large-v3-turbo`, `@cf/baai/bge-m3`. |

## O que não mexer

A conta tem outros projetos. Um agent não lista “o primeiro bucket” nem altera nada fora da tabela de cima.

Workers existentes: `sidespace-cdn`, `whoami-fit`, `zero63-combr-redirect`, `zero63-workout-api`.

D1 existente além deste: `zero63-videos`.

Buckets R2 existentes: `cdn-sidespace`, `stagepads`, `weserve-cloud`, `zero63-media`, `zero63-workout-videos`.

DNS de `timdevops.com.br` que não seja o host `tobias`: não alterar.

## Segredos

Só via `wrangler secret`. Nunca no git, nunca num markdown.

- `BOOTSTRAP_TOKEN` — uma vez, para criar o owner. Depois deixa de servir quando já existe um household.
- `PIN_PEPPER` — segredo do hash do PIN do tablet.
- `SESSION_PEPPER` — se a sessão guardada não for só um id opaco com lookup no D1. Preferir id opaco no cookie e a linha no D1. Nesse caso este segredo não é preciso.

## Limites a respeitar no código

- Worker no plano Free: 10 ms de CPU por pedido. I/O (D1, R2, modelo) não conta como CPU. Manter o JavaScript curto.
- Workers AI: 10.000 neurónios por dia incluídos. Acima disso, no Free, a inferência pára até à meia-noite UTC.
- Áudio máximo 60 s. Ficheiro máximo 10 MB.
- Gateway: 120 pedidos por minuto neste id. Não subir isto para “não falhar” um ciclo de retry.

## Como um agent usa o MCP

Namespace `plugin-cloudflare-cloudflare`. Conta `6a4b8e5b2ac1dcea60835a6c12208dac`.

Antes de criar seja o que for, ler este ficheiro. Se o recurso da tabela já existe, usá-lo. O MCP já provou `d1:edit`, `r2_bucket:edit`, `vectorize:edit`, `worker:edit`, `dns_records:edit` e a execução de Workers AI.
