# Pacote speech

Dono de `src/infrastructure/ai/stt.ts` e `src/http/routes/speech.ts`. Exporta `transcribe` e `registerSpeech`.

Corte 2. O prototype funciona sem esta rota.

## Pedido

`POST /api/speech`, sessão obrigatória. Multipart:

- `audio`: bytes, `Content-Type` `audio/mp4` ou `audio/mpeg` ou `audio/webm`. Outro mime: 400 `validation`.
- `clientMessageId`: UUID. Só entra no `usage.trace` como correlação. Não cria `messages`.

Limites, antes de chamar o modelo:

- Mais de 8 MB: 400.
- Duração: o Worker não descodifica o mp4 para medir. O cliente corta aos 60 s. Aqui, recusar content-length acima de 8 MB chega. Se o content-type vier vazio, 400.

Chamada:

```ts
env.AI.run(env.AI_STT_MODEL, { audio: [...bytes], language: "pt" }, { gateway: { id: env.AI_GATEWAY_ID } })
```

Confirmar os nomes dos campos no schema do modelo `@cf/openai/whisper-large-v3-turbo` no dia da implementação (MCP `ai/models/schema`). Não trocar de modelo se o campo se chamar `audio` noutro formato: adaptar o input, manter `AI_STT_MODEL`.

Resposta 200: `{ clientMessageId, transcript }`. `transcript` é string trimada. Vazia: 400 `validation`, mensagem `Não ouvi nada.`

Não escrever o transcript em `usage` nem em log. `usage` leva `model`, `latency_ms`, `error_code`, `trace_id`.

Falha do Workers AI: 503 `unavailable`, mensagem `A voz falhou. Podes escrever.`

Não há fallback OpenAI neste corte. Isso fica atrás de uma var que ainda não existe. Não a criar.

## Aceitação

- Sem sessão, 401.
- Mime `text/plain`, 400, e o modelo não é chamado.
- Fake de `AI.run` que devolve texto: a rota devolve esse texto e a tabela `messages` continua vazia.
- O áudio não é posto no R2. Não há `files` novo depois do pedido.
