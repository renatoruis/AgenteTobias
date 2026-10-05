# Pacote client

Dono de `src/client/**`. PWA Vite + React, sem biblioteca de UI. Servida pelo mesmo Worker, em `https://tobias.timdevops.com.br`.

O cliente fala só com `/api` na mesma origem. Não tem chaves. Não calcula somas para mostrar como se fossem verdade: mostra `reply` e, na lista de lembretes, o JSON de `GET /api/reminders`.

## Ecrãs

Um shell, três zonas, telemóvel primeiro (largura 390). Safari iOS.

1. **Entrada.** Sem sessão (`GET /api/me` → 401): ecrã com o nome AgenteTobias e o botão “Entrar”. Login WebAuthn via `@simplewebauthn/browser` contra `/api/auth/login/options` e `/api/auth/login`. Não há campo de password. Não há login Google.
2. **Chat.** Lista de bolhas. Campo de texto. Enviar. A bolha do utilizador aparece logo. A resposta substitui o estado “A registar…”.
3. **Lembretes.** Lista por cima do chat, ou um separador “Lembretes” no mesmo ecrã. Título e data civil em Lisboa. Vazio: “Sem lembretes.”

Botões em cada confirmação interpretada: **Desfazer** (`POST /api/events/:id/void`) e **Editar** (reabre o texto e reenvia com `correctsEventId` e um `clientMessageId` novo).

## Push-to-talk

Botão grande, redondo, fixo por cima do teclado. Rótulo acessível: “Falar”.

- `pointerdown`: pedir microfone, `MediaRecorder` com `mimeType: "audio/mp4"` quando o Safari o oferecer. Se não oferecer, `audio/webm`.
- Enquanto grava, o botão muda de estado visível (não só cor: texto “A ouvir…”).
- `pointerup` ou aos 60 s: para, envia `POST /api/speech`.
- Menos de 0,4 s: não envia. Mensagem “Segura um pouco mais.”
- A transcrição aparece numa caixa editável. Botão “Registar” chama `POST /api/messages` com esse texto e `source` implícito (o servidor marca `text`; o cliente não precisa do campo `source` porque não está no contrato do POST). O contrato de messages não tem `source`. Não o acrescentar. A mensagem de voz, para o servidor, é texto depois de editada.
- Falha 503: “A voz falhou. Podes escrever.” O campo de texto fica utilizável.

Não usar Web Speech API.

## Offline

Service worker da shell: cache do HTML, JS e CSS. Fila em `IndexedDB` só para `POST /api/messages` de texto, com o mesmo `clientMessageId`, quando `navigator.onLine` é falso ou o fetch falha por rede. Ao voltar, reenviar. Não enfileirar áudio nem ficheiros.

## Confirmação e erros

Mostrar `reply` tal como vem. Mostrar `error.message` do JSON do contrato. Não inventar uma segunda redação.

€ e datas: se o ecrã precisar de formatar um `dueAt`, usar `Europe/Lisbon` e `pt-PT`.

## Manifesto

`name`: AgenteTobias. `display`: `standalone`. `start_url`: `/`. `theme_color` e ícone simples gerados no próprio pacote (SVG ou PNG pequeno). Sem depender de um serviço externo.

## Aceitação

- Em 390 px de largura, o botão Falar não fica por baixo do campo de texto.
- Enviar “gastei 10 euros no Lidl” mostra a bolha antes da resposta.
- Segurar o botão menos de 0,4 s não chama `/api/speech`.
- 401 em `/api/me` mostra Entrar, não o chat vazio como se a pessoa estivesse lá.
