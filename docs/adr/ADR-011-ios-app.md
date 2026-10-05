# ADR-011 — App iOS nativa

Substitui [ADR-005](ADR-005-pwa.md).

## Context

A família usa iPhone. Web Push no Safari continua frágil, e a app precisa de definições, notificações e personalização ao nível de uma app instalada. A distribuição é o TestFlight, não uma PWA no ecrã principal.

## Options

- Manter a PWA.
- Capacitor à volta do cliente React.
- App SwiftUI, com a mesma API no Worker.

## Decision

A app da família é SwiftUI, iOS 17 ou mais recente, bundle `br.com.timdevops.tobias`, distribuída pelo TestFlight. O Worker em `https://tobias.timdevops.com.br` é só a API, mais a associação de passkeys e uma página curta a dizer para abrir a app. Não há PWA, service worker, nem manifesto.

A sessão continua a ser o cookie `tobias_session`. A app fala com a API por `URLSession`. Não há bearer token.

Os lembretes chegam por APNs. O Worker guarda o token do aparelho, as preferências da pessoa, e um envio por lembrete e por pessoa para não repetir o aviso. Horas de silêncio usam `Europe/Lisbon`. Uma criança não recebe lembrete `adults`.

O RP ID WebAuthn é `tobias.timdevops.com.br`, para o ficheiro de associação viver neste host. O modo kiosk do tablet fica na API e fora desta app.

## Pros

- Notificações, ícone, voz e definições são as do iOS.
- A API, o D1 e as tools não mudam de papel.
- Um código de cliente, o do iPhone.

## Cons

- Conta Apple Developer e um envio manual para o TestFlight.
- O Mac e o browser deixam de ter cliente.
- Passkeys nativas dependem do domínio associado.

## Risks

A origin que a app põe na asserção WebAuthn pode não ser a do site. Mitigação: o verifier aceita `https://tobias.timdevops.com.br`; uma origin diferente só entra na lista depois de um registo real no aparelho. Push em debug usa o ambiente sandbox; TestFlight usa production.

## Exit strategy

A app só conhece HTTP. Outro cliente pode usar as mesmas rotas. As preferências e os tokens estão no D1, ao lado da sessão.
