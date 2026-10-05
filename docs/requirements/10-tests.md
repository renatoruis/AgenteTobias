# Pacote tests

Dono de `tests/**`. Pode importar `src/domain` e, nos testes de integração, as funções de application. Não altera produção para “facilitar o teste”. Se uma função não for exportada como o contrato manda, o teste falha e o outro pacote corrige.

Runner: Vitest, já instalado pelo platform.

## tests/unit

Tabela de `src/domain/money.ts`, `dates.ts`, `alias.ts`, `warranty.ts`, `access.ts`, `reply.ts`, com os casos escritos nesses documentos. Um ficheiro por módulo.

Casos que não podem faltar:

- `70`, `70 euros`, `€70`, `70,50`, `70.50`, `70 conto`.
- `18.450` não é `1845000` cêntimos. O parser de dinheiro rejeita. O parser de quilómetros devolve `18450`.
- Garantia de 24 meses a partir de 5 de outubro de 2026 acaba a 5 de outubro de 2028.
- `child` não lê `adults` nem o `private` de outro.
- Alias `Continente` e `continente` normalizam para o mesmo string.

## tests/integration

D1 em Miniflare ou no D1 local do Wrangler, base vazia, migration `0001_init.sql` aplicada no setup.

- Dois households. Uma despesa no A. A soma e o `GET` de eventos no B não a vêem.
- Mesmo `client_message_id` duas vezes: um evento.
- `AI.run` é um fake injetado. Não há rede nestes testes.

O fake devolve uma sequência de respostas na forma OpenAI chat-completion (`choices[0].message`), uma por chamada: primeiro uma `tool_call`, depois o texto final. Fluxo A:

```json
[
  { "choices": [{ "message": { "tool_calls": [{ "id": "call_1", "type": "function",
      "function": { "name": "remember", "arguments": "{\"text\":\"gastei 80 euros no Continente\",\"type\":\"expense\",\"occurredAt\":\"hoje\",\"amountMinor\":8000,\"entities\":[{\"name\":\"Continente\",\"kind\":\"merchant\"}]}" } }] } }] },
  { "choices": [{ "message": { "content": "Anotado, €80 no Continente." }}] }
]
```

Exige que, depois de `handleMessage`, exista um evento `active` com `amount_minor = 8000`, a resposta seja `interpreted` com o texto do modelo, e a segunda chamada ao fake tenha uma mensagem `tool` com `saved.amountMinor = 8000`.

Fluxo B: dois veículos semeados, `remember` com entidade «carro», o tool devolve `ambiguous_vehicle` com as duas opções, o modelo pergunta. Zero eventos novos.

Fluxo da proposta: `income` de 60000 cêntimos acima de `CONFIRM_ABOVE_MINOR`, resposta `proposal`, «sim» na mensagem seguinte grava sem segunda chamada ao fake.

Fluxo da soma: dois eventos semeados no mês corrente, `total` devolve `totalMinor = 8000` ao modelo; o texto final é do modelo.

Fluxo de falha: o primeiro modelo lança, o fallback responde; se ambos lançarem, `stored` sem eventos.

## tests/evals

`tests/evals/phrases.json`. Não corre no `vitest` de cada commit. Corre quando alguém muda o prompt, as tools ou o modelo, com a rede ligada:

```
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npx vitest run --config tests/evals/vitest.config.ts
```

`AI_INTERPRET_MODEL` escolhe o modelo (default `openai/gpt-5-mini`; comparar com `google-ai-studio/gemini-2.5-flash-lite`). O runner usa o `SYSTEM_PROMPT`, o cartão da casa e as `toolDefinitions()` reais de `src/application/agent/context.ts`, pelo endpoint compat do AI Gateway, e só avalia a primeira resposta do modelo.

Cada item: `input`, `fixture` (entidades já existentes), `expect` (`tool`, `type`, `amountMinor`, `entityNames`, `warrantyMonths`, `orQuestionMentioning`). `tool: null` significa resposta em texto sem tools.

Frases obrigatórias:

| input | expect |
| --- | --- |
| abasteci o i30 70 euros | `remember`, `vehicle.fuel`, 7000, i30 |
| a Renata comprou uma air fryer por 129 e tem dois anos de garantia | `remember`, purchase ou warranty, 12900, warrantyMonths 24 |
| guardei a chave reserva na gaveta | `remember`, `object.location`, place gaveta |
| gastei 80 conto no continente | `remember`, expense, 8000, Continente |
| o carro está com 18500 km | com i30 e Aveo no fixture: `remember` (o tool devolve `ambiguous_vehicle`) ou pergunta que nomeia os dois |
| quanto gastamos no Continente este mês? | `total`, expense, Continente, sem `remember` |
| Hoje vendi o teclado por 600 euros | `remember`, income, 60000 |
| Hoje é o meu primeiro dia no trabalho novo | `remember`, note |
| Quais foram os registos de hoje? | `recall` |
| Olá Tobias, tudo bem? | texto, sem tools |

## Aceitação

`npm test` passa sem token Cloudflare e sem rede. A eval fica de fora desse comando.
