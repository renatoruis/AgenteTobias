# Pacote search

Dono de `src/infrastructure/search.ts` e `src/application/search/**`.

## Texto canónico

`canonicalText` junta, numa linha, o `summary` do evento e a data civil em Lisboa. Sem JSON cru. Sem texto de outros eventos. Exemplo: `expense €80 Continente 2026-10-05`.

`indexEvent(db, eventId)` escreve ou substitui a linha em `events_fts` com `body = summary + " " + message.text`.

## FTS

`searchText(db, session, query)` :

- `MATCH` no body.
- `household_id` da sessão.
- Descartar eventos que `canRead` recuse.
- No máximo 8 resultados, mais recente primeiro.
- Se o MATCH lançar por sintaxe (aspas tortas), devolver lista vazia, não 500.

## Vetores

Só quando `env.EMBEDDINGS === "1"`.

`embedPending(env, limit)` :

1. Buscar até `limit` (máximo 20) jobs `pending`.
2. Se o evento está `voided` ou `superseded` e há `vector_id`, apagar o vetor e marcar o job `ready` com `vector_id` null. Não reembutir.
3. Se o evento está `active`, calcular `canonicalText`, hash SHA-256. Se o hash é igual a `text_hash` e o status ia a `ready`, saltar. Senão, `AI.run(AI_EMBED_MODEL, { text }, { gateway })`.
4. O vetor tem de ter 1024 números. Outro comprimento: marcar `failed` e não escrever no índice.
5. Metadata do vetor: `householdId`, `visibility`, `eventId`. O id do vetor é o `eventId`.
6. Upsert. Sucesso: `ready` e `text_hash`. Falha do Vectorize: deixar `pending`. O registo do evento não se desfaz.

`searchText` com embeddings ligados faz também a query ao índice filtrada por `householdId`. Junta os ids aos do FTS, hidrata no D1, volta a aplicar `canRead`. O D1 é a resposta. O score não sai na API.

Filtro de metadata do Vectorize não substitui `canRead`. Os dois correm.

## Cron

O platform chama `embedPending(env, 20)` no cron `15 * * * *`. Esta função não assume o relógio: também pode ser chamada no `waitUntil` depois de `record_event`. O pacote agent pode chamar `waitUntil(embedPending(env, 5))` se `EMBEDDINGS` for `1`. Se for `0`, não chama.

## Aceitação

- Evento do household B não aparece na pesquisa do household A, nem por FTS nem por vetor.
- Evento `adults` não aparece para `child`.
- Com `EMBEDDINGS=0`, `embedPending` não chama `AI.run`.
- Anular e correr `embedPending` remove o id do índice quando o binding de teste o permite. No unitário, um fake do índice chega.
