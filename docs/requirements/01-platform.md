# Pacote platform

Dono de `package.json`, `tsconfig.json`, `wrangler.jsonc`, `src/env.ts`, `src/http/index.ts`, `src/http/app.ts`.

Não implementa auth, interpretação, SQL de negócio, nem ecrãs. Liga as rotas que os outros pacotes exportam.

## wrangler.jsonc

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "agentetobias",
  "main": "src/http/index.ts",
  "compatibility_date": "2026-10-05",
  "routes": [
    { "pattern": "tobias.timdevops.com.br", "custom_domain": true }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "agentetobias",
      "database_id": "0ce884cc-676a-4a4b-8b37-3ded77968528"
    }
  ],
  "r2_buckets": [
    { "binding": "FILES", "bucket_name": "agentetobias-files" }
  ],
  "vectorize": [
    { "binding": "VECTORS", "index_name": "agentetobias-events" }
  ],
  "ai": { "binding": "AI" },
  "triggers": { "crons": ["15 * * * *", "*/5 * * * *"] },
  "vars": {
    "AI_GATEWAY_ID": "agentetobias",
    "AI_INTERPRET_MODEL": "openai/gpt-5-mini",
    "AI_FALLBACK_MODEL": "google-ai-studio/gemini-2.5-flash-lite",
    "AI_STT_MODEL": "@cf/openai/whisper-large-v3-turbo",
    "AI_EMBED_MODEL": "@cf/baai/bge-m3",
    "EMBEDDINGS": "0",
    "CONFIRM_ABOVE_MINOR": "50000",
    "APNS_BUNDLE_ID": "br.com.timdevops.tobias"
  }
}
```

`src/env.ts` exporta `Env` com estes bindings e vars, mais `BOOTSTRAP_TOKEN` e `PIN_PEPPER` como `string`. `APNS_TEAM_ID`, `APNS_KEY_ID` e `APNS_AUTH_KEY` são opcionais até os segredos existirem.

O cron `15 * * * *` chama `embedPending` de `src/infrastructure/search.ts`. O cron `*/5 * * * *` chama `dispatchDueReminders`. Se o ficheiro ainda não existir no momento do primeiro `wrangler dev`, o handler do cron regista o erro e não entra em retry infinito.

## HTTP

`src/http/app.ts` cria o Hono, aplica:

- `trace_id` por pedido (UUID), header de resposta `x-trace-id`;
- cookie parser mínimo, sem dependência extra se o Hono já o trouxer;
- rotas `/api/*` via `registerAuth`, `registerMessages`, `registerEvents`, `registerReminders`, `registerSpeech`, `registerFiles`;
- `GET /` devolve a página estática;
- `GET /.well-known/apple-app-site-association` devolve o JSON da app;
- qualquer outro caminho é 404.

Erros não tratados: `{ error: { code: "unavailable", message: "Falhou. Tenta outra vez." } }` com 500, e log só com `trace_id` e o nome do erro. Sem body do pedido no log.

Cabeçalhos de segurança na resposta HTML e na API: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` que permita a própria origem e recuse frames.

## Scripts

`package.json`:

- `dev` — `wrangler dev`
- `typecheck` — `tsc --noEmit`
- `test` — `vitest run`
- `build` — `tsc --noEmit`. O Worker não tem assets de cliente.

Não correr `wrangler deploy` neste pacote sem pedido. `wrangler dev` sim.

## Aceitação

- `wrangler dev` arranca com os bindings locais de D1, R2 e Vectorize.
- `GET /api/me` sem cookie devolve 401 no formato do contrato, assim que o pacote auth estiver ligado.
- O nome do Worker é `agentetobias`. Não se cria outro script.
