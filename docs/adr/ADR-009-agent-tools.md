# ADR-009 — Execução das tools do agente

## Context

O modelo não pode receber SQL nem gravar JSON livre. Também não deve haver uma tool por cada conceito do domínio, senão a superfície cresce e a escolha degrada-se. A aplicação é quem decide o que é permitido. Conteúdo externo (frase, transcrição, PDF futuro) é não confiável.

## Options

- Uma tool por ação de negócio (`registerExpense`, `registerFuel`, …), como na lista ilustrativa do pedido.
- Poucas tools genéricas, com o tipo do facto validado por schema.
- O modelo devolve JSON e o servidor grava esse JSON depois de um filtro leve.
- SQL gerado pelo modelo, com uma conta só de leitura.

## Decision

Tools: `record_event`, `resolve_or_create_entity`, `ask_clarification`, `search_events`, `search_text`, `correct_event`, `void_event`, `create_reminder`, `attach_file`.

Cada uma tem schema Zod. O `household_id` e o ator vêm da sessão, nunca dos argumentos do modelo. `record_event` valida o `type`: despesa exige montante e moeda; combustível exige um veículo já resolvido. Opcionais podem faltar. Alias normalizado existente não cria segunda entidade. Duas entidades possíveis levam a `ask_clarification` e a zero escritas.

Confirmação sem pontuação inventada: schema válido e uma entidade produzem a frase curta, com Editar e Desfazer. Caso contrário, uma pergunta.

## Pros

- A lista de tools cabe na cabeça de uma pessoa.
- Tipos novos são schemas, não endpoints.
- Injeção de prompt não muda papel, household nem SQL.
- Parâmetros alucinados falham a validação em vez de gravar.

## Cons

- Os schemas por tipo têm de ser mantidos com o mesmo cuidado que as tools teriam. Um schema frouxo anula a decisão.
- O modelo pode chamar `void_event` a mais. O id tem de existir neste household, a ação fica no histórico, e a pessoa tem a mensagem original para reprocessar.

## Risks

Tool de leitura a devolver memórias `adults` a uma criança, se o filtro de visibilidade ficar só no prompt. Mitigação: o filtro está na query, não na instrução. Escrita em nome de outro membro. Mitigação: `actor_id` da sessão.

## Exit strategy

Se um tipo ficar demasiado condicional para um schema único, ganha uma função de validação própria atrás da mesma tool `record_event`. Partir em várias tools é um passo posterior, medido pela taxa de tool errada no eval, não um ponto de partida.
