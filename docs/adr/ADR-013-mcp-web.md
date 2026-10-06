# ADR-013 — Base no Worker, web de gestão, cliente MCP

Substitui [ADR-011](ADR-011-ios-app.md) no que toca à interface da família.

## Context

A família quer uma base só: factos, membros, entidades e instruções. Trocar de GPT para Claude, ou para outro assistente, muda o ecrã onde se fala, não a base. A app iOS deixa de ser o produto. O Worker deixa de escolher o modelo e de escrever a resposta.

## Options

- Manter a app SwiftUI e o loop de modelo no Worker.
- MCP local numa máquina em casa.
- Worker com a base, páginas web para gerir a casa, e um MCP remoto para qualquer assistente.

## Decision

A base fica no Worker. D1 é a fonte dos factos. As tools `remember`, `recall`, `total`, `amend` e `void` continuam a validar e a gravar. O `household_id` vem da sessão, nunca do modelo.

A interface da família, por agora, é:

- Páginas HTML no mesmo host: casa (membros e entidades), estatísticas lidas do D1, e a ligação da API.
- `POST /mcp`, protocolo MCP em JSON-RPC. O token da casa (hash no D1, texto mostrado uma vez) autentica o assistente e vira a sessão do owner que o criou. Sem token válido, 401.
- No `initialize`, o servidor entrega as instruções e o cartão da casa. Há também um prompt e um resource com o mesmo cartão.

Passkeys no browser continuam a ser o login da web. Não há app iOS, associação Apple, nem push APNs.

Claude e Cursor ligam com o URL e o token. O OAuth do ChatGPT fica para depois.

O Worker não escolhe modelo. Quem fala é o assistente ligado ao MCP.

## Pros

- Trocar de assistente não muda factos, papéis nem somas.
- A web trata do cadastro. O chat não se constrói aqui.
- Dinheiro, datas e visibilidade ficam no código que já existia.

## Cons

- O histórico da conversa vive no assistente, não no D1. O D1 guarda o facto e a mensagem técnica da tool.
- O ChatGPT web não liga enquanto não houver OAuth. A app móvel do ChatGPT não liga a conectores custom.
- Quem não é owner não gere a casa nem o token.

## Risks

Um token copiado para o sítio errado lê e grava a casa. Mitigação: hash no D1, texto mostrado uma vez, revogação na web, 401 sem Bearer. O modelo continua sem SQL e sem escolher o household.

## Exit strategy

OAuth para o ChatGPT acrescenta login, não uma segunda base. Uma app, se voltar, fala com as mesmas tools.
