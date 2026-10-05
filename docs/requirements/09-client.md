# Pacote client

Dono de `ios/**`. App SwiftUI, iOS 17 ou mais recente, bundle `br.com.timdevops.tobias`. Fala com `https://tobias.timdevops.com.br` por `URLSession` e o cookie `tobias_session`. Não tem chaves. Não calcula somas: mostra `reply` e, na lista de lembretes, o JSON de `GET /api/reminders`.

Texto da família em português de Portugal. Três separadores: Conversas, Lembretes, Definições.

## Entrada

Sem sessão (`GET /api/me` → 401): ecrã com o nome AgenteTobias.

- `GET /api/setup` com `needsBootstrap: true`: token, nome e nome da casa, depois a passkey do bootstrap.
- Caso contrário: **Entrar** (passkey) e convite (`POST /api/auth/register` com `inviteCode` e `displayName`, depois a passkey).

A passkey usa `AuthenticationServices` com RP ID `tobias.timdevops.com.br` e o JSON WebAuthn que o Worker já verifica. O desafio vai no cookie `tobias_challenge`.

## Conversas

Lista de bolhas. Campo de texto. Enviar. A bolha da pessoa aparece logo, com “A registar…”. A resposta mostra `reply`.

Botões numa proposta (`status: "proposal"`): **Gravar** e **Não** (`POST /api/messages/:id/confirm`). Depois de gravado: **Desfazer** (`POST /api/events/:id/void`) e **Editar** (reenvia com `correctsEventId` e um `clientMessageId` novo).

**Falar** é um botão redondo ao lado do campo, não por baixo. `pointer` equivalente: toque longo. Grava `audio/mp4` até 60 s. Menos de 0,4 s não envia e diz “Segura um pouco mais.” Soltar envia `POST /api/speech`. A transcrição fica editável. **Registar** chama `POST /api/messages`. Falha de voz: a mensagem de erro do contrato, ou “A voz falhou. Podes escrever.”

Foto ou PDF: `POST /api/files`. Sucesso: “Ficheiro guardado.”

Fila local só para `POST /api/messages` de texto, com o mesmo `clientMessageId`, quando a rede falha.

Se a preferência de voz estiver ligada, a `reply` lê-se com `AVSpeechSynthesizer`, `pt-PT`. Começar a gravar pára a leitura.

## Lembretes

Título e data civil em Lisboa. Vazio: “Sem lembretes.” Um aviso que abre a app seleciona o lembrete. A ação **Feito** chama `POST /api/reminders/:id/done`.

## Definições

- **Conta.** Nome (`PATCH /api/me`), papel, passkey neste iPhone, terminar sessão, aparelhos (`GET /api/sessions`, `POST /api/sessions/:id/revoke`). A pessoa revoga as suas. O owner revoga qualquer uma da casa.
- **Casa** (owner). Nome (`PATCH /api/household`), membros (`GET /api/users`), convite (`POST /api/invites`). O código mostra-se uma vez.
- **Aparência.** Tema e cor em `GET/PUT /api/me/preferences`: `system` | `light` | `dark`, e `teal` | `blue` | `green` | `orange`. Três ícones no bundle (predefinido, escuro, laranja), guardados no aparelho. O tamanho do texto segue o Dynamic Type.
- **Voz.** `speakReplies` e `rate` entre 0 e 1.
- **Notificações.** Permissão do iOS, lembretes, som, distintivo, horas de silêncio (`quietHours` com `start` e `end` em `HH:mm`, ou `null`). O token APNs vai em `PUT /api/devices/current/push` com `environment` `sandbox` em debug e `production` no TestFlight.
- **Privacidade.** Estado do microfone, das fotos e das notificações, com ligação às definições do sistema.

## Aceitação

- O botão Falar não fica por baixo do campo de texto.
- Enviar “gastei 10 euros no Lidl” mostra a bolha antes da resposta.
- Segurar o botão menos de 0,4 s não chama `/api/speech`.
- 401 em `/api/me` mostra Entrar, não o chat vazio.
