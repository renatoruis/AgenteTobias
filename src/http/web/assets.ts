export const GESTAO_CSS = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.45; }
body { margin: 0; }
main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
nav { display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem; }
nav a { color: inherit; }
nav form { margin: 0; }
button, input, select { font: inherit; }
label { display: block; margin: 0.6rem 0; }
input, select { width: 100%; max-width: 24rem; padding: 0.4rem 0.5rem; }
button { padding: 0.4rem 0.8rem; }
.erro { color: #9b1c1c; }
.codigo { font-family: ui-monospace, monospace; word-break: break-all; }
ul { padding-left: 1.2rem; }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: 0.3rem 0.6rem 0.3rem 0; vertical-align: top; }
.numeros { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
.numeros p { margin: 0.2rem 0; }
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
  var copiar = document.getElementById("copiar")
  if (copiar) {
    copiar.addEventListener("click", function () {
      var node = document.getElementById("token")
      if (!node || !navigator.clipboard) return
      navigator.clipboard.writeText(node.textContent || "")
    })
  }
})()
`
