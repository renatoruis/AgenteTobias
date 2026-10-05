# ADR-005 — PWA em vez de aplicação nativa

## Context

O uso é iPhone, iPad fixo em casa, Mac e browser. Não há distribuição na App Store no início. A prioridade é simplicidade, custo baixo, pouca manutenção e uma experiência próxima de uma app, instalável no ecrã principal, com Safari.

## Options

- PWA (Vite + React) servida como static assets do mesmo Worker.
- Site responsivo sem instalação.
- Capacitor à volta da mesma web app.
- Aplicação nativa (Swift) mais tarde, ou já.

## Decision

PWA instalável, mobile-first, um Worker a servir a shell e a API. Service worker limita-se à shell e à fila de texto offline. Sem Capacitor e sem app nativa nesta fase.

## Pros

- Um código para telemóvel, tablet e computador.
- Sem conta de developer Apple para a família instalar.
- Deploy igual ao da API.
- Safari recebe a PWA no ecrã principal.

## Cons

- Push no iOS exige PWA instalada e continua frágil. Por isso o push fica para a V1; no MVP os lembretes estão no ecrã.
- Microfone, gravação e passkeys têm as arestas do Safari. O desenho de voz (`audio/mp4`) e de sessão já as inclui.
- Sem acesso fundo a localização. Isso alinha com a regra de não seguir ninguém.

## Risks

Um limite do Safari (gravação, passkeys, storage da fila) a bloquear o gesto principal. Mitigação: provar voz e passkey num iPhone real antes de alargar o MVP. Capacitor só entra com um limite concreto, não por antecipação.

## Exit strategy

A UI fala com HTTP. Uma casca nativa ou Capacitor pode reutilizar a API e, se valer a pena, o cliente. Nada no D1 assume que o cliente é um browser.
