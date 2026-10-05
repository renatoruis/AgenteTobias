# ADR-002 — Armazenamento vetorial

## Context

Há perguntas em que as palavras não coincidem com o registo (“geladeira” contra “frigorífico”). Um banco vetorial encontra esses eventos. Não pode ser a fonte dos valores: somas, datas e garantias leem-se no D1. Os embeddings têm de ser reconstruíveis.

A página de preços dos Workers, lida em 5 de outubro de 2026, diz que o Vectorize está no plano Paid e, na mesma tabela, lista 5 milhões de dimensões guardadas no Free. Até a conta confirmar, o índice trata-se como capacidade do plano pago.

## Options

- Cloudflare Vectorize, um vetor por evento, com `event_id`.
- Sem vetores: FTS5 e aliases apenas.
- Embeddings dentro do D1 e semelhança calculada no Worker.
- Outro motor vetorial gerido.

## Decision

FTS5 e aliases desde o protótipo. Vectorize no MVP, assim que a conta o tiver: modelo `@cf/baai/bge-m3`, um texto canónico por evento (frase original mais uma linha montada em código), metadata `household_id`, `visibility`, `event_id`. Escrita em `waitUntil`, com cron para o que ficar `pending`. A resposta semântica hidrata sempre no D1.

Não se embute tudo. Não há segundo modelo a resumir o evento.

## Pros

- O caso que o FTS não resolve fica coberto.
- Custo de armazenamento baixo mesmo com anos de histórico (cêntimos a cerca de $1 por mês no heavy a cinco anos, no plano pago).
- Falha do índice não impede gravar uma despesa.
- Apagar o evento apaga o vetor. Dá para refazer o índice a partir do D1.

## Cons

- Mais um binding e mais um estado (`pending | ready | failed`).
- Pode obrigar ao plano Paid mais cedo.
- Qualidade em português depende do modelo de embedding, a confirmar no conjunto de avaliação.

## Risks

Vetores fantasma depois de um undo, ou fuga entre households se o filtro de metadata falhar. Mitigação: apagar pelo `event_id` na mesma transação lógica da anulação, e filtrar `household_id` mais visibilidade antes de mostrar linhas. Teste de integração cobre os dois.

Dimensão do bge-m3 fixa-se no dia da implementação pela ficha do modelo (referência pública: 1024). O índice não mistura dimensões.

## Exit strategy

O texto canónico está no D1. Trocar de motor é reembutir. Não há informação que exista só no Vectorize.
