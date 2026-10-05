# Pacote platform

Dono de `package.json`, `tsconfig.json`, `wrangler.jsonc`, `src/env.ts`, `src/http/index.ts`, `src/http/app.ts`, `index.html` na raiz se o Vite o exigir.

Não implementa auth, interpretação, SQL de negócio, nem ecrãs. Liga as rotas que os outros pacotes exportam.

## wrangler.jsonc

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "agentetobias",
  "main": "src/http/index.ts",
  "compatibility_date": "2026-10-05",
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS"
  },
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
  "triggers": { "crons": ["15 * * * *"] },
  "vars": {
    "AI_GATEWAY_ID": "agentetobias",
    "AI_INTERPRET_MODEL": "@cf/qwen/qwen3-30b-a3b-fp8",
    "AI_STT_MODEL": "@cf/openai/whisper-large-v3-turbo",
    "AI_EMBED_MODEL": "@cf/baai/bge-m3",
    "EMBEDDINGS": "0"
  }
}
```

`src/env.ts` exporta `Env` com estes bindings e vars, mais `BOOTSTRAP_TOKEN` e `PIN_PEPPER` como `string`.

O cron chama `embedPending` de `src/infrastructure/search.ts`. Se o ficheiro ainda não existir no momento do primeiro `wrangler dev`, o handler do cron regista o erro e responde 200 para o cron não entrar em retry infinito. Quando o pacote search existir, a chamada é direta.

## HTTP

`src/http/app.ts` cria o Hono, aplica:

- `trace_id` por pedido (UUID), header de resposta `x-trace-id`;
- cookie parser mínimo, sem dependência extra se o Hono já o trouxer;
- rotas `/api/*` via `registerAuth`, `registerMessages`, `registerEvents`, `registerReminders`, `registerSpeech`, `registerFiles`;
- qualquer outro GET cai nos assets.

Erros não tratados: `{ error: { code: "unavailable", message: "Falhou. Tenta outra vez." } }` com 500, e log só com `trace_id` e o nome do erro. Sem body do pedido no log.

Cabeçalhos de segurança na resposta HTML e na API: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` que permita a própria origem e recuse frames.

## Scripts

`package.json`:

- `dev` — `wrangler dev`
- `typecheck` — `tsc --noEmit`
- `test` — `vitest run`
- `build` — build do Vite para `dist/client` e depois o Worker está pronto para deploy

Não correr `wrangler deploy` neste pacote sem pedido. `wrangler dev` sim.

## Aceitação

- `wrangler dev` arranca com os bindings locais de D1, R2 e Vectorize.
- `GET /api/me` sem cookie devolve 401 no formato do contrato, assim que o pacote auth estiver ligado.
- O nome do Worker é `agentetobias`. Não se cria outro script.
