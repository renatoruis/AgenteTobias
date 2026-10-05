# Pacote auth

Dono de `src/application/auth/**` e `src/http/routes/auth.ts`. Exporta `registerAuth` e `readSession`.

RP ID WebAuthn: `timdevops.com.br`. Origin: `https://tobias.timdevops.com.br`. Não usar `localhost` como origin aceite em produção. Em `wrangler dev`, a origin local pode estar na lista só quando `import.meta.env` ou uma var `WEB_AUTHN_ORIGIN` existir. Default da var: `https://tobias.timdevops.com.br`.

Bibliotecas: `@simplewebauthn/server` no Worker, `@simplewebauthn/browser` no cliente (o cliente chama-as; este pacote documenta o JSON que o browser precisa).

## Bootstrap

`POST /api/bootstrap` com `{ token, displayName, householdName }`.

1. Se `token` não coincidir com `BOOTSTRAP_TOKEN`, 401 `unauthorized`. Mensagem genérica, sem dizer se o token está perto.
2. Se já existir uma linha em `households`, 403 `forbidden` com `A casa já existe.`
3. Criar household (`Europe/Lisbon`, `EUR`, `pt-PT`), user `owner`, device `personal` com nome `primeiro telemóvel`, sessão de 30 dias, cookie.
4. Resposta 200: o corpo de `GET /api/me` mais `registration: "pending"`.

O registo da passkey é o passo seguinte, com a sessão já posta. Sem passkey o cookie de bootstrap expira em 30 minutos (`Max-Age=1800`), não em 30 dias. Quando a passkey fica gravada, a sessão passa a 30 dias.

## Passkey

`POST /api/auth/register/options` exige sessão. Devolve `options` do SimpleWebAuthn para `navigator.credentials.create`.

`POST /api/auth/register` recebe a resposta do browser, verifica, grava `passkeys`, alonga a sessão.

`POST /api/auth/login/options` não revela se o utilizador existe. Devolve options de discoverable credential.

`POST /api/auth/login` verifica a asserção, cria device `personal` se o cookie de device ainda não existir, cria sessão, põe o cookie.

`POST /api/auth/logout` marca `revoked_at` e apaga o cookie (`Max-Age=0`).

`readSession` devolve `null` se o cookie falta, a linha não existe, `revoked_at` está preenchido, ou `expires_at` já passou.

## Convites (corte 2)

`POST /api/invites` com sessão `owner` e `{ role, displayName }`. `role` não pode ser `owner`. Gera um código de 8 caracteres, guarda só o hash (SHA-256 com `PIN_PEPPER`), expira em 7 dias. A resposta mostra o código uma vez: `{ code, expiresAt, role }`.

`POST /api/auth/register` aceita também `{ inviteCode, displayName }` sem sessão, para o novo membro. O código é de uso único (`used_at`). Código errado ou gasto: 400 `validation`, mensagem `Convite inválido.`

## Kiosk (corte 2)

Fora do corte 1. Não bloquear o prototype por causa disto.

Um `owner` regista o tablet com `POST /api/kiosk/devices` `{ name }`, sessão owner. Cria `devices.kind = kiosk` e devolve um código de emparelhamento de uso único, no mesmo modelo do convite.

`POST /api/kiosk/unlock` `{ deviceCode, userId, pin }`:

- O device tem de ser `kiosk` deste household.
- O user tem de ser deste household.
- `pin_hash` compara com PBKDF2-SHA-256, pelo menos 100.000 iterações, sal por user, pimenta `PIN_PEPPER`. No plano Free, se as 10 ms de CPU estourarem, baixar para 20.000 e registar isso num ADR. Não guardar o PIN.
- Cinco falhas no mesmo device em 10 minutos: 401 até o intervalo passar.
- Sessão de 15 minutos. Conteúdo `private` e `adults` continua a depender do papel, não do device.

O owner define o PIN com `POST /api/users/:id/pin` `{ pin }`, sessão owner ou o próprio user adulto. PIN com 4 a 6 dígitos.

## Aceitação

- Bootstrap com token errado não cria linhas.
- Segundo bootstrap falha.
- Login sem passkey válida não põe cookie.
- `readSession` ignora sessão revogada.
- Um id de user de outro household no kiosk devolve 404, não 403.
