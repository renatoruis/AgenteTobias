export const GESTAO_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f2f2f7;
  --sidebar: rgba(249, 249, 249, 0.92);
  --cell: #fff;
  --label: #000;
  --secondary: rgba(60, 60, 67, 0.6);
  --sep: rgba(60, 60, 67, 0.16);
  --blue: #007aff;
  --red: #ff3b30;
  --fill: rgba(0, 0, 0, 0.05);
  --bar: rgba(249, 249, 249, 0.86);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000;
    --sidebar: rgba(28, 28, 30, 0.94);
    --cell: #1c1c1e;
    --label: #fff;
    --secondary: rgba(235, 235, 245, 0.6);
    --sep: rgba(84, 84, 88, 0.65);
    --blue: #0a84ff;
    --red: #ff453a;
    --fill: rgba(255, 255, 255, 0.1);
    --bar: rgba(28, 28, 30, 0.86);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--label);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  font-size: 17px;
  line-height: 1.3;
  -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
h1 {
  margin: 2px 16px 0;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.45px;
  line-height: 1.12;
}
h2 {
  margin: 28px 32px 7px;
  font-size: 13px;
  font-weight: 400;
  color: var(--secondary);
}
.sub, .footnote {
  margin: 6px 32px 0;
  color: var(--secondary);
  font-size: 13px;
  line-height: 1.35;
}
.sub { font-size: 15px; margin: 4px 16px 0; }
.banner, .erro { margin: 8px 16px 0; color: var(--red); font-size: 15px; }
.erro:empty { display: none; }
.inset {
  margin: 8px 16px 0;
  background: var(--cell);
  border-radius: 10px;
  overflow: hidden;
}
.inset > :not(:first-child) {
  background-image: linear-gradient(var(--sep), var(--sep));
  background-repeat: no-repeat;
  background-size: calc(100% - 16px) 0.5px;
  background-position: 16px 0;
}
.row, .field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  margin: 0;
  padding: 10px 16px;
}
.stack { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.detail, .value { color: var(--secondary); }
.value { font-variant-numeric: tabular-nums; flex: none; }
.empty { color: var(--secondary); }
.field > span { flex: none; }
.field input, .field select {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--label);
  font-size: 17px;
  text-align: right;
  padding: 0;
}
.field input::placeholder { color: var(--tertiary, var(--secondary)); }
.field select { appearance: none; }
.field:has(select)::after {
  content: "";
  width: 7px;
  height: 7px;
  margin-left: -6px;
  border-right: 1.5px solid var(--secondary);
  border-bottom: 1.5px solid var(--secondary);
  transform: rotate(45deg) translateY(-2px);
  flex: none;
}
.secret {
  margin: 0;
  padding: 14px 16px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-all;
}
.secret.code {
  padding: 22px 16px;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-align: center;
}
button.primary {
  display: block;
  width: calc(100% - 32px);
  height: 50px;
  margin: 16px 16px 0;
  border: 0;
  border-radius: 12px;
  background: var(--blue);
  color: #fff;
  font-size: 17px;
  font-weight: 600;
}
button.link, button.destructive {
  display: block;
  width: 100%;
  min-height: 44px;
  border: 0;
  background: transparent;
  font-size: 17px;
  text-align: center;
}
button.link { color: var(--blue); }
button.destructive { color: var(--red); }
button.primary:active, button.link:active, button.destructive:active { opacity: 0.55; }
.content a, .gate a { color: var(--blue); text-decoration: none; }
.sidebar { display: none; }
.topbar { display: flex; justify-content: flex-end; min-height: 44px; padding: 4px 8px 0; }
.topbar button, .sidebar-foot button {
  border: 0;
  background: transparent;
  font-size: 17px;
}
.topbar button { color: var(--blue); padding: 8px; }
.tabbar {
  position: fixed;
  z-index: 2;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: calc(49px + env(safe-area-inset-bottom));
  padding: 4px 6px env(safe-area-inset-bottom);
  background: var(--bar);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid var(--sep);
}
.tabbar a {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: var(--secondary);
  font-size: 10px;
  letter-spacing: 0.1px;
  text-decoration: none;
}
.tabbar a[aria-current="page"] { color: var(--blue); }
.tabbar svg, .sidebar svg { display: block; }
.tabbar svg { width: 26px; height: 22px; }
.content { padding: 0 0 calc(64px + env(safe-area-inset-bottom)); }
.gate {
  min-height: 100dvh;
  display: grid;
  align-content: center;
  width: min(400px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 48px;
}
.gate h1 { margin: 0; text-align: center; font-size: 40px; letter-spacing: -0.8px; }
.gate .lead { margin: 6px 0 22px; text-align: center; color: var(--secondary); font-size: 17px; }
.gate .inset { margin-left: 0; margin-right: 0; }
.gate button.primary { width: 100%; margin-left: 0; margin-right: 0; }
.gate h2 { margin-left: 16px; }
@media (min-width: 880px) {
  .app { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100dvh; }
  .sidebar {
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100dvh;
    background: var(--sidebar);
    -webkit-backdrop-filter: blur(24px);
    backdrop-filter: blur(24px);
    border-right: 0.5px solid var(--sep);
  }
  .brand {
    margin: 0;
    padding: 22px 18px 10px;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.4px;
  }
  .sidebar nav { display: flex; flex-direction: column; padding: 4px 8px; }
  .sidebar nav a {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    margin: 1px 0;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--label);
    font-size: 14px;
    text-decoration: none;
  }
  .sidebar nav a[aria-current="page"] { background: var(--fill); font-weight: 600; }
  .sidebar svg { width: 18px; height: 18px; }
  .sidebar-foot { margin-top: auto; padding: 8px; }
  .sidebar-foot button {
    width: 100%;
    padding: 8px;
    border-radius: 7px;
    color: var(--red);
    font-size: 14px;
    text-align: left;
  }
  .sidebar-foot button:hover, .sidebar nav a:hover { background: var(--fill); }
  .topbar, .tabbar { display: none; }
  .content { max-width: 680px; padding: 36px 40px 72px; }
  h1 { margin-left: 0; margin-right: 0; font-size: 28px; }
  .sub, .banner, .erro { margin-left: 0; margin-right: 0; }
  h2, .footnote { margin-left: 16px; margin-right: 0; }
  .inset { margin-left: 0; margin-right: 0; }
  button.primary { width: 100%; margin-left: 0; margin-right: 0; }
}
@media (max-width: 879px) {
  .brand, .sidebar-foot { display: none; }
}
`

export const GESTAO_JS = `
(function () {
  var erro = document.getElementById("erro")
  function show(message) {
    if (erro) erro.textContent = message
  }
  function b64urlToBuf(value) {
    var pad = "=".repeat((4 - (value.length % 4)) % 4)
    var b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/")
    var bin = atob(b64)
    var bytes = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }
  function bufToB64url(buffer) {
    var bytes = new Uint8Array(buffer)
    var bin = ""
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "")
  }
  function decode(options) {
    var copy = Object.assign({}, options)
    copy.challenge = b64urlToBuf(options.challenge)
    if (options.user && options.user.id) {
      copy.user = Object.assign({}, options.user, { id: b64urlToBuf(options.user.id) })
    }
    ;["excludeCredentials", "allowCredentials"].forEach(function (key) {
      if (!options[key]) return
      copy[key] = options[key].map(function (item) {
        return Object.assign({}, item, { id: b64urlToBuf(item.id) })
      })
    })
    return copy
  }
  function credentialJson(credential) {
    if (typeof credential.toJSON === "function") return credential.toJSON()
    var response = credential.response
    var body = {
      id: credential.id,
      rawId: bufToB64url(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
      response: { clientDataJSON: bufToB64url(response.clientDataJSON) }
    }
    if (response.attestationObject) body.response.attestationObject = bufToB64url(response.attestationObject)
    if (response.authenticatorData) body.response.authenticatorData = bufToB64url(response.authenticatorData)
    if (response.signature) body.response.signature = bufToB64url(response.signature)
    if (response.userHandle) body.response.userHandle = bufToB64url(response.userHandle)
    return body
  }
  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return null }).then(function (payload) {
        if (!response.ok) {
          var message = payload && payload.error && payload.error.message ? payload.error.message : "Falhou."
          throw new Error(message)
        }
        return payload
      })
    })
  }
  function registerPasskey(options) {
    return navigator.credentials.create({ publicKey: decode(options) }).then(function (credential) {
      if (!credential) throw new Error("A passkey não foi criada.")
      return postJson("/api/auth/register", credentialJson(credential))
    })
  }
  var entrar = document.getElementById("entrar")
  if (entrar) {
    entrar.addEventListener("click", function () {
      show("")
      postJson("/api/auth/login/options")
        .then(function (payload) {
          return navigator.credentials.get({ publicKey: decode(payload.options) })
        })
        .then(function (credential) {
          if (!credential) throw new Error("Não foi possível entrar.")
          return postJson("/api/auth/login", credentialJson(credential))
        })
        .then(function () { location.href = "/casa" })
        .catch(function (error) { show(error.message || "Não foi possível entrar.") })
    })
  }
  var bootstrap = document.getElementById("bootstrap")
  if (bootstrap) {
    bootstrap.addEventListener("submit", function (event) {
      event.preventDefault()
      show("")
      var data = new FormData(bootstrap)
      postJson("/api/bootstrap", {
        token: String(data.get("token") || ""),
        displayName: String(data.get("displayName") || ""),
        householdName: String(data.get("householdName") || "")
      })
        .then(function (payload) { return registerPasskey(payload.options) })
        .then(function () { location.href = "/casa" })
        .catch(function (error) { show(error.message || "Falhou.") })
    })
  }
  var convite = document.getElementById("convite")
  if (convite) {
    convite.addEventListener("submit", function (event) {
      event.preventDefault()
      show("")
      var data = new FormData(convite)
      postJson("/api/auth/register", {
        inviteCode: String(data.get("inviteCode") || ""),
        displayName: String(data.get("displayName") || "")
      })
        .then(function (payload) { return registerPasskey(payload.options) })
        .then(function () { location.href = "/casa" })
        .catch(function (error) { show(error.message || "Convite inválido.") })
    })
  }
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var node = document.getElementById(button.getAttribute("data-copy") || "")
      if (!node || !navigator.clipboard) return
      var label = button.textContent
      navigator.clipboard.writeText((node.textContent || "").trim()).then(function () {
        button.textContent = "Copiado"
        setTimeout(function () { button.textContent = label }, 1600)
      })
    })
  })
  document.querySelectorAll("form").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      var button = event.submitter
      var message = (button && button.getAttribute("data-confirm")) || form.getAttribute("data-confirm")
      if (message && !confirm(message)) event.preventDefault()
    })
  })
})()
`
