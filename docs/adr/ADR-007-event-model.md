# ADR-007 — Modelo de eventos

## Context

A mesma frase pode ser despesa, manutenção e veículo ao mesmo tempo. Mais tarde a família corrige, desfaz e volta a perguntar. O pedido avisa contra uma tabela por conceito logo no início, e pede para a mensagem original ficar ligada ao que foi interpretado. Cálculos (somas, fim de garantia, datas relativas) têm de ser determinísticos.

## Options

- Uma tabela por tipo (despesas, abastecimentos, garantias, objetos, …).
- Um fluxo de eventos imutável puro, com projeções materializadas à parte.
- Mensagem imutável mais facto genérico versionado, com colunas indexadas e JSON.

## Decision

`messages` imutáveis. `events` com `type`, `status` (`active | voided | superseded`), `version`, colunas para dinheiro e tempo, JSON `data` para o resto. Entidades e aliases à parte, ligadas por `event_entities`. Corrigir supersede e cria versão. Desfazer marca `voided` e apaga derivados (vetor, ficheiro órfão). A mensagem fica.

Tipos iniciais são valores de um schema, não tabelas: `expense`, `purchase`, `vehicle.fuel`, `vehicle.maintenance`, `warranty`, `object.location`, `note`, `incident`, `reminder`.

Não há projeção materializada. A soma é uma query. Uma projeção só nasce se uma query real o justificar.

## Pros

- Uma frase, um ou mais factos, uma origem.
- Dá para reprocessar, reembutir e exportar.
- Evita dezenas de CRUD.
- Idempotência por `(household_id, client_message_id)` impede o retry de duplicar €70.

## Cons

- Disciplina nos schemas: um `type` novo sem validação vira JSON solto.
- Queries ad hoc sobre campos que ficaram só no JSON são mais fracas. O remédio é promover o campo a coluna quando passar a ser filtrado, não antecipar todas.

## Risks

O modelo inventar um `type` ou uma entidade. Mitigação: lista fechada de types no MVP, alias único, e escrita recusada quando há empate. Garantia calculada pelo modelo em vez do código. Mitigação: o código soma os meses; o modelo só propõe o número.

## Exit strategy

Se um tipo ganhar regras e volume próprios (por exemplo combustível com litros obrigatórios e integração com o carro), pode ganhar colunas ou uma tabela, copiando a partir de `events`. Até lá, o export JSON descreve os factos sem depender dessa separação.
