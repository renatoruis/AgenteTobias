# ADR-003 — Abstração do provedor de IA

Substituído por [ADR-012](ADR-012-conversational-agent.md).

## Context

O modelo interpreta a frase e escolhe uma tool. Não soma, não autoriza e não grava sozinho. O pedido pede independência de um único fornecedor (OpenAI, Anthropic, OpenRouter, Workers AI) e avalia um classificador prévio (“JEV”) para poupar o modelo grande.

O custo estimado do modelo pequeno, se todas as mensagens o usarem, fica entre ~$0,27 e ~$2,73 por mês nos três cenários familiares. Uma pipeline de dois modelos não paga essa conta e acrescenta latência.

## Options

- Um modelo no Workers AI, id em configuração, AI Gateway à frente.
- AI Gateway com BYOK para OpenAI ou Anthropic como caminho principal.
- Classificador barato e, só depois, um modelo capaz.
- Vários modelos em cascata por mensagem.

## Decision

Interface `AIProvider` com `interpret`, `transcribe` e `embed`. Implementação inicial: Workers AI. Candidato de interpretação: `@cf/qwen/qwen3-30b-a3b-fp8` ($0,051 / $0,335 por milhão de tokens, function calling). O id vai numa variável (`AI_INTERPRET_MODEL`).

AI Gateway no meio, núcleo gratuito, cache de interpretação desligada, corpo dos pedidos desligado. Chaves só no Worker ou no BYOK.

Uma chamada por mensagem. Fallback: no máximo um segundo provedor, uma tentativa, timeout curto. Sem JEV e sem cascata.

A escolha definitiva do modelo espera pelo conjunto de ~50 frases. A troca não muda as tools nem o D1.

## Pros

- Um sítio para trocar de modelo.
- Custo e latência de uma ida só.
- Chaves fora do browser.
- Observabilidade de tokens e latência sem guardar o texto.

## Cons

- O candidato pode falhar em PT-PT. Aí o fallback deixa de ser exceção e passa a principal, com o custo desse provedor.
- O AI Gateway é mais uma configuração. O ganho (limite, BYOK, métricas) compensa um proxy caseiro.

## Risks

Retry a multiplicar chamadas. Mitigação: idempotência da mensagem e limite por household. Log do gateway a guardar frases da família. Mitigação: corpos desligados, revisto no deploy.

## Exit strategy

Outro provedor entra como nova implementação da mesma interface, ativada por configuração. Os factos já gravados não dependem de nenhum modelo.
