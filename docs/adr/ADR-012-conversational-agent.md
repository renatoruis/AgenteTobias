# ADR-012 — Agente conversacional com loop de tools

Substitui [ADR-003](ADR-003-ai-provider.md) e [ADR-009](ADR-009-agent-tools.md).

## Context

O corte 1 obrigava o modelo a escolher uma de nove tools (`tool_choice: "required"`), não o deixava escrever a resposta (saía de `src/domain/reply.ts`), fazia uma chamada só (sem ler o resultado de uma pesquisa), e tinha uma lista fechada de tipos sem venda nem receita. Com uma família real, qualquer frase fora do molde caía em `stored` e a pessoa via «Guardado, ainda por interpretar». Perguntas simples («o que registei hoje?») viravam pedidos de clarificação. Vendas viravam «Não há despesas este mês».

O Qwen no Workers AI nunca passou por um conjunto de avaliação em português. O desenho «IA só na interpretação, aplicação escreve o texto» produziu um IVR, não um agente.

## Options

- Manter o interpretador e afinar o prompt e os templates.
- Agente com loop de tools, o modelo escreve a resposta, guarda-corpos deterministas no servidor.
- API realtime áudio-a-áudio de um provedor.

## Decision

Agente conversacional. Por mensagem:

1. O servidor monta o contexto em código: persona e regras (estável), cartão da casa (membros, entidades por tipo, moeda, fuso), eventos de hoje visíveis ao papel, últimos turnos da conversa com as respostas do Tobias, data e hora de Lisboa, papel de quem fala.
2. Uma chamada a um modelo externo pelo binding `AI` com `gateway.id`, modelo em `AI_INTERPRET_MODEL` (`openai/gpt-5-mini` à partida), `tool_choice: "auto"`.
3. Até três iterações tool → modelo. Resultados de tools voltam ao modelo como JSON. O modelo escreve sempre a frase final em português, na variante de quem fala, curta.
4. `AI_FALLBACK_MODEL`, uma tentativa, se o principal falhar. Só quando os dois falham a mensagem fica `stored` e a frase de `reply.ts` serve de fallback.

Tools, em `src/domain/tools.ts`, todas com schema Zod e `household_id` e `actor_id` da sessão:

| Tool | Efeito |
| --- | --- |
| `remember` | Grava um facto. `type` do enum do ADR-007 mais `income`. Cêntimos por `money.ts`, data por `dates.ts`, alias normalizado liga ou cria entidade, garantia e lembrete como antes. |
| `recall` | FTS5 e filtros de tipo, entidade, intervalo. Devolve linhas. |
| `total` | `SUM(amount_minor)` em SQL. O número nunca vem do modelo. |
| `amend` | Nova versão de um evento, o anterior fica `superseded`. |
| `void` | Anula. |

Confirmação: `remember` grava logo e o modelo diz o que gravou. A app mostra Desfazer e Editar. Só há proposta («Entendi: … Gravo?») quando `amountMinor > CONFIRM_ABOVE_MINOR` (default 50000). Ambiguidade real (dois veículos para «o carro», campo obrigatório em falta) é um erro da tool que volta ao modelo; o modelo pergunta em texto. Não há status `clarification` no contrato.

Faturação: Unified Billing do AI Gateway. Sem chave de provedor no Worker nem no gateway. Crédito pré-pago na conta Cloudflare.

Vectorize fica desligado (`EMBEDDINGS=0`). FTS5 com filtros de data chega a uma família.

O que continua determinista: autorização e household, cêntimos e moeda, datas no fuso de Lisboa, fim de garantia, somas, anulação e versão, visibilidade no `WHERE`.

## Pros

- A pessoa fala e recebe uma frase que faz sentido, mesmo quando a mensagem não é um facto.
- Uma pesquisa seguida de resposta com os dados reais, sem segunda infra.
- Quatro tools cabem na cabeça. Tipos novos são valores, não endpoints.
- Trocar de modelo é uma variável. O eval em `tests/evals` decide.

## Cons

- Duas chamadas em metade das mensagens. Latência e custo sobem face a uma chamada, mas o custo total fica em ~$2 por mês para 60 mensagens por dia.
- O texto final é do modelo. Um modelo fraco pode dizer uma soma errada mesmo com o número certo na tool. Mitigação: o prompt exige usar os números devolvidos; a app mostra `events` com os valores do servidor.
- O cache de prompt do provedor expira com minutos de inactividade; numa família o prefixo raramente fica em cache. Já contado no custo.

## Risks

Loop a girar três vezes por hábito. Mitigação: teto de três, `usage` regista tokens por mensagem. Cartão da casa a crescer sem limite. Mitigação: teto de entidades no cartão. O modelo chamar `void` a mais. Mitigação: id tem de existir neste household, acção fica no histórico, a mensagem original permite reprocessar.

## Exit strategy

O domínio, as tools e o D1 não dependem do provedor. Outro modelo é outra string em `AI_INTERPRET_MODEL`. Voltar ao Workers AI é pôr um `@cf/` lá. Streaming e resumo rolante da conversa entram sem mudar o contrato.
