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

Fake mínimo para o fluxo A, devolvido pela tool `record_event`:

```json
{
  "type": "expense",
  "occurredAt": "hoje",
  "visibility": "household",
  "data": { "amountMinor": 8000, "currency": "EUR" },
  "entityName": "Continente",
  "entityKind": "merchant"
}
```

O teste não exige que o fake fale. Exige que, depois de `handleMessage`, exista um evento `active` com `amount_minor = 8000` e a reply `Registrei €80 no Continente.`

Fluxo B: dois veículos semeados, frase “abasteci o carro”, fake que pede clarificação. Zero eventos novos.

Fluxo da soma: dois eventos semeados no mês corrente, `searchEvents` devolve a soma, sem chamada ao fake.

## tests/evals

`tests/evals/phrases.json`. Não corre no `vitest` de cada commit. Corre quando alguém muda o prompt ou o modelo, com a rede ligada, e compara o JSON.

Cada item: `input`, `fixture` (entidades já existentes), `expect` (`type`, `amountMinor`, `entityNames`, `tool`, `clarification`).

Frases obrigatórias:

| input | expect |
| --- | --- |
| abasteci o i30 70 euros | tool `record_event`, type `vehicle.fuel`, amountMinor 7000, entity i30, sem clarificação |
| a Renata comprou uma air fryer por 129 e tem dois anos de garantia | purchase ou warranty, 12900, warrantyMonths 24 |
| guardei a chave reserva na gaveta | `object.location`, sem clarificação de divisão extra |
| gastei 80 conto no continente | expense, 8000, Continente |
| o carro está com 18500 km | com i30 e Aveo no fixture: clarificação, sem evento |
| quanto gastamos no Continente este mês? | tool `search_events`, sem `record_event` |

Um script `tests/evals/run.ts` lê o JSON, chama o modelo real e imprime diferenças. Não faz parte de `npm test`.

## Aceitação

`npm test` passa sem token Cloudflare e sem rede. A eval fica de fora desse comando.
