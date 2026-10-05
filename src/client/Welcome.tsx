import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { bootstrapHouse, fetchSetup, joinWithInvite, loginWithPasskey } from "./requests"

export function Welcome({ message, onSuccess }: { message: string | null; onSuccess: () => void }) {
  const [mode, setMode] = useState<"login" | "create" | "invite">("login")
  const [needsBootstrap, setNeedsBootstrap] = useState(false)
  const [error, setError] = useState<string | null>(message)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError(message)
  }, [message])

  useEffect(() => {
    void fetchSetup().then((setup) => {
      if (setup?.needsBootstrap) {
        setNeedsBootstrap(true)
        setMode("create")
      }
    })
  }, [])

  async function enter() {
    setBusy(true)
    setError(null)
    const result = await loginWithPasskey()
    setBusy(false)
    if (result.kind === "cancelled") return
    if (result.kind === "error") {
      setError(result.message ?? "Não foi possível entrar.")
      return
    }
    onSuccess()
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const result = await bootstrapHouse({
      token: String(data.get("token") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      householdName: String(data.get("householdName") ?? ""),
    })
    setBusy(false)
    if (result.kind === "cancelled") return
    if (result.kind === "error") {
      setError(result.message ?? "Não foi possível criar a casa.")
      return
    }
    onSuccess()
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const result = await joinWithInvite({
      inviteCode: String(data.get("code") ?? "").trim(),
      displayName: String(data.get("displayName") ?? ""),
    })
    setBusy(false)
    if (result.kind === "cancelled") return
    if (result.kind === "error") {
      setError(result.message ?? "Convite inválido.")
      return
    }
    onSuccess()
  }

  return (
    <main className="screen welcome">
      <p className="eyebrow">AgenteTobias</p>
      <h1>A memória da casa.</h1>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {mode === "login" && (
        <div className="stack">
          <button type="button" className="filled" onClick={() => void enter()} disabled={busy}>
            Entrar
          </button>
          <button type="button" className="text" onClick={() => setMode("invite")}>
            Tenho um convite
          </button>
          {needsBootstrap && (
            <button type="button" className="text" onClick={() => setMode("create")}>
              Criar a casa
            </button>
          )}
        </div>
      )}
      {mode === "create" && (
        <form className="group" onSubmit={(event: FormEvent<HTMLFormElement>) => void create(event)}>
          <label>
            Código da casa
            <input name="token" autoComplete="off" required />
          </label>
          <label>
            O teu nome
            <input name="displayName" autoComplete="name" required />
          </label>
          <label>
            Nome da casa
            <input name="householdName" required />
          </label>
          <button type="submit" className="filled" disabled={busy}>
            Continuar
          </button>
          <button type="button" className="text" onClick={() => setMode("login")}>
            Já tenho conta
          </button>
        </form>
      )}
      {mode === "invite" && (
        <form className="group" onSubmit={(event: FormEvent<HTMLFormElement>) => void join(event)}>
          <label>
            Código
            <input name="code" autoCapitalize="characters" autoComplete="off" required />
          </label>
          <label>
            O teu nome
            <input name="displayName" autoComplete="name" required />
          </label>
          <button type="submit" className="filled" disabled={busy}>
            Entrar na casa
          </button>
          <button type="button" className="text" onClick={() => setMode("login")}>
            Voltar
          </button>
        </form>
      )}
    </main>
  )
}
