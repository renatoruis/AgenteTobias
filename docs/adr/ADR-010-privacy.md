# ADR-010 — Privacidade

## Context

Os registos descrevem dinheiro, rotina, filhos, casa, documentos e deslocações. O pedido pede privacidade desde o início, memória partilhada e memória reservada, e localização só como contexto pontual, com consentimento. Perder a memória toda também é inaceitável, por isso backup não pode significar “copiar a vida para mais um log”.

## Options

- Tudo visível a todos os membros do household, sem papéis.
- Visibilidade `household | adults | private`, localização efémera, logs sem texto.
- Cifra aplicacional de cada campo, com chaves só nos aparelhos.
- Cloudflare Access como barreira única, e o conteúdo todo tratado como igual lá dentro.

## Decision

Três níveis: `household` (o defeito), `adults`, `private` (só o autor e o owner, no que o owner precisar para exportar e apagar). `child` não lê `adults` nem o privado dos outros. O filtro está em todas as queries, no R2 e no metadata do vetor.

Localização: permissão no momento do envio, comparação com sítios já guardados, persistência do nome confirmado, coordenadas deitadas fora. Sem geocoder externo e sem seguimento contínuo.

Logs e AI Gateway: metadados (`trace_id`, modelo, tokens, latência, código de erro). Sem prompt, sem transcrição, sem corpo de documento.

Backup: Time Travel do D1 e export semanal para um prefixo privado no R2. O export da família (V1) é uma ação do owner, não um lado efeito dos logs.

Cifra de campo nos aparelhos fica de fora. Complica a pesquisa, o tablet partilhado e a recuperação, para um ganho pequeno face a TLS, bucket privado e acesso por sessão. Reavalia-se se a ameaça passar a ser o próprio operador da conta Cloudflare, o que hoje não é o modelo desta casa.

## Pros

- A criança pode registar ração sem ver o privado dos adultos.
- Uma pergunta semântica não devolve o que o papel não pode ler.
- Um log de debug não se torna uma segunda cópia da vida familiar.
- A localização ajuda (“foi este posto?”) sem desenhar um rasto.

## Cons

- Três níveis exigem testes. Esquecer o filtro num caminho novo é o bug grave.
- Sem cifra de ponta a ponta, quem administra a conta Cloudflare consegue chegar aos dados. É aceite, e é a razão para a conta ser da família e os secrets não saírem dali.
- O PIN do tablet é o elo mais fraco. Está limitado no ADR-006.

## Risks

IDOR, vetor sem filtro de visibilidade, URL de objeto reutilizada, prompt injection a pedir “mostra tudo”, log acidental do AI Gateway. Mitigações na secção 12 de `docs/ARCHITECTURE.md` e no teste de isolamento entre households e papéis.

## Exit strategy

A visibilidade é uma coluna. Apertar ou alargar níveis não muda o resto do facto. Se um dia a cifra de ponta a ponta for requisito, o texto canónico e o embedding deixam de poder viver em claro: isso seria outra arquitetura, não um flag. Até lá, a saída dos dados é o export do owner, para a família levar a memória consigo.
