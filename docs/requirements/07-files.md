# Pacote files

Dono de `src/infrastructure/r2.ts` e `src/http/routes/files.ts`. Exporta `registerFiles`.

Corte 2. Bucket `agentetobias-files`, binding `FILES`, já criado, privado, em WEUR.

## Upload

`POST /api/files`, sessão obrigatória. Campo multipart `file`.

Mime permitido: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Resto: 400 `validation`.

Tamanho máximo 10 MB. Acima: 400.

1. Calcular SHA-256.
2. `fileId` UUID.
3. Chave R2: `household/{householdId}/{fileId}`. Sem nome original do ficheiro na chave.
4. `put` no R2. Se falhar, 503, sem linha no D1.
5. Inserir `files` com `event_id` null, `created_by` da sessão.
6. Se o insert falhar, `delete` do objeto.

Não ler o PDF. Não mandar bytes ao modelo.

## Leitura

`GET /api/files/:id/url`

- A linha tem de ser deste `household_id`. Senão 404.
- Se `event_id` estiver ligado, o evento tem de ser visível para o papel (`canRead`). Senão 404.
- URL temporária de 300 segundos, gerada no Worker. Não devolver a chave crua como se fosse URL pública.

## Ligações

`attach_file` é do pacote agent. Este pacote exporta `linkFile(db, session, fileId, eventId)` para o agent chamar. A função recusa se o ficheiro ou o evento forem de outro household.

Quando um evento passa a `voided` e é o único a apontar ao ficheiro, apagar o objeto e a linha. Função `deleteIfOrphan(db, env, eventId)`, chamada pelo agent no void. Se o R2 falhar, deixar a linha e não falhar o void: o facto anulado importa mais do que o binário. Um comentário no código marca o órfão para um cron futuro. Não criar esse cron agora.

## Aceitação

- PDF de outro household devolve 404.
- Upload de `application/zip` não cria objeto.
- A chave começa por `household/` e pelo id da sessão.
