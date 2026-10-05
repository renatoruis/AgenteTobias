# Pacote domain

Dono de `src/domain/**`. Sem I/O. Sem Hono. Sem `fetch`. Funções puras e schemas Zod. Os testes que provam estas funções são do pacote tests; aqui só o código.

## Ficheiros

- `src/domain/types.ts` — cópia fiel dos tipos em [00-contract.md](00-contract.md).
- `src/domain/tools.ts` — Zod das oito tools e dos `data` por `EventType`.
- `src/domain/money.ts` — texto para cêntimos e cêntimos para frase pt-PT.
- `src/domain/dates.ts` — “hoje”, “ontem”, “sábado”, “semana passada” em `Europe/Lisbon`.
- `src/domain/alias.ts` — `normalizeAlias`.
- `src/domain/warranty.ts` — `warrantyEndsOn(purchaseDate, months, timeZone)`.
- `src/domain/reply.ts` — `replyFor(event)` e `summaryFor(event)` com as frases do contrato.
- `src/domain/access.ts` — `canRead(role, visibility, actorId, userId)` e `canVoid(...)`.

## Dinheiro

Entrada possível, saída em cêntimos ou erro:

| Texto | Cêntimos |
| --- | --- |
| `70` | 7000 |
| `70 euros` | 7000 |
| `€70` | 7000 |
| `70,50` | 7050 |
| `70.50` | 7050 |
| `70 conto` | 7000 |

`70.50` é setenta euros e cinquenta cêntimos, não setenta mil e quinhentos. Em pt-PT o ponto também aparece como separador decimal quando há uma ou duas casas. `1.850` com três casas depois do ponto, ou `18.450 km`, não é dinheiro: é um número de quilómetros e esta função não o aceita como euros. Quilómetros ficam noutro parser, inteiros, em `src/domain/numbers.ts`: `18450`, `18.450`, `18,450` → `18450`.

Saída: `formatEur(7000)` → `€70`. `formatEur(7050)` → `€70,50`.

## Datas

`resolveWhen(text, now, "Europe/Lisbon")` devolve o instante UTC do início do dia civil, exceto quando a frase traz hora.

- `hoje` — o dia de `now` em Lisboa.
- `ontem` — o dia anterior.
- `sábado` — o sábado da semana corrente em Lisboa; se hoje for sábado, é hoje.
- `semana passada` — segunda-feira da semana anterior.

Sem expressão relativa, o caller usa o dia de `now`.

## Alias

`normalizeAlias`: minúsculas, trim, sem acentos (`continente` = `Continente`), espaços internos colapsados. Não apaga dígitos (`i30` fica `i30`).

## Acesso

- `household`: todos os papéis leem.
- `adults`: `owner`, `adult`. `member` e `child` não.
- `private`: o `actor_id` e o `owner`.

`child` não grava `visibility: "adults"` nem `private` de outro user.

## Garantia

`warrantyEndsOn("2026-10-05", 24, "Europe/Lisbon")` → data civil `2028-10-05`. Meses de calendário, não `24 * 30` dias. Dia 31 num mês curto cai no último dia desse mês.

## Aceitação

O pacote tests cobre as tabelas desta página. Este pacote está feito quando essas funções existem com estes nomes e não importam nada de `src/http`, `src/infrastructure` ou `src/application`.
