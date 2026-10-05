# ADR-001 — Base de dados

## Context

O AgenteTobias guarda a memória da casa: factos com valor, data, entidade e texto original. Esses registos são a fonte de verdade. A busca por significado é outro índice. A família quer custo perto de zero, zero administração de servidor, e a app a funcionar com a casa desligada.

Volume de referência: 100 a 1.000 mensagens por dia, cinco pessoas, horizonte de cinco anos. A ~2 KB por evento, isso vai de centenas de megabytes a cerca de 3,6 GB.

## Options

- Cloudflare D1 (SQLite gerido).
- Neon ou Supabase (Postgres gerido).
- Turso (SQLite gerido, outro fornecedor).
- SQLite num VPS ou num disco em casa.

## Decision

D1 é a única base. Colunas para o que se filtra e se soma (`household_id`, `type`, `occurred_at`, `amount_minor`, `currency`, `actor_id`, `visibility`, `status`). JSON para o resto do payload. FTS5 para texto.

## Pros

- Já vive ao lado do Worker, sem outra conta nem outra password.
- Plano Free útil para o protótipo: 5 milhões de linhas lidas por dia, 100 mil escritas por dia.
- Time Travel incluído (7 dias no Free, 30 no Paid), sem custo extra de backup.
- SQL normal, exportável.
- Cabe no volume familiar dentro de 10 GB no plano Paid.

## Cons

- No Free, 500 MB por base e 10 ms de CPU no Worker que a usa. Cinco anos a 100 mensagens por dia aproximam-se dos 500 MB.
- Concorrência é a de SQLite. Para uma família chega; para um SaaS, não.
- Funções e limites são os da Cloudflare.

## Risks

Encher os 500 MB ou bater no CPU do Free no meio de uma escrita. Mitigação: medir no protótipo e passar ao Workers Paid ($5 por mês, base até 10 GB) quando a base passar de ~400 MB ou a CPU falhar. Não há segundo esquema para “o dia em que migrarmos”.

## Exit strategy

O domínio não conhece D1. Conhece factos e queries. Drizzle e SQL portável mais o export JSON/ZIP (V1) permitem ir para outro SQLite ou para Postgres. Embeddings e ficheiros não estão dentro das linhas, por isso a saída da base não arrasta o índice nem os binários.
