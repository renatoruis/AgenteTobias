# ADR-006 — Autenticação

## Context

Cinco pessoas, vários aparelhos, um tablet na sala que muda de mãos, crianças e adultos, dados que não podem saltar de household. A autenticação tem de ser simples no iOS e na PWA. Não há IAM. O pedido prefere passkeys, e aceita OAuth, magic link ou um esquema familiar simples.

## Options

- Passkeys (WebAuthn) e sessões próprias. No tablet, aparelho kiosk com escolha de membro e PIN.
- Cloudflare Access com lista de emails.
- Google OAuth.
- Magic link por email.
- Uma password partilhada da casa.

## Decision

Passkeys nos telemóveis e portáteis. Cookie de sessão `HttpOnly`, `Secure`, `SameSite`. Sessões revogáveis, guardadas no D1.

O owner regista o tablet como `kiosk`. O ecrã mostra os membros. Um PIN (hash com segredo no Worker) abre uma sessão curta daquela pessoa. Timeout volta à escolha. Papéis `owner | adult | member | child` vivem no D1, não no fornecedor de login.

Convite: o owner cria o membro e esse membro regista a passkey no próprio aparelho.

## Pros

- Sem password partilhada e sem depender da Google para as crianças.
- Troca rápida de pessoa no tablet, que o Access (redirect de email) torna desconfortável.
- Revogação é apagar sessões. Um telemóvel perdido não exige outro fornecedor.
- O papel fica junto dos dados que esse papel protege.

## Cons

- Há código de sessão e de WebAuthn para escrever e testar. É a peça mais sensível do MVP.
- Passkeys precisam de domínio HTTPS estável.
- O PIN do tablet é mais fraco do que uma passkey. Fica contido nesse aparelho, com limite de tentativas e timeout.

## Risks

PIN curto adivinhado na sala. Mitigação: poucas tentativas, sessão curta, memórias `private` e `adults` invisíveis para `child`. Roubo de cookie. Mitigação: flags do cookie, revogação, HTTPS. Confundir o kiosk com uma sessão de owner deixada aberta. Mitigação: o kiosk nunca herda a sessão pessoal; cada escolha pede PIN.

## Exit strategy

A aplicação conhece `user_id`, `household_id` e `role` na sessão. Trocar o método de login (Access ou magic link) substitui a porta de entrada, não as queries. As passkeys podem conviver com um segundo método se a família ficar bloqueada fora do domínio.
