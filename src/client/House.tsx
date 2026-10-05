import { useCallback, useEffect, useState } from "react"
import type { FormEvent } from "react"
import { addMember, addVehicle, fetchHousehold } from "./requests"
import type { Member, Vehicle } from "./requests"
import type { Me } from "./types"

const ROLE_LABEL: Record<Member["role"], string> = {
  owner: "Dono",
  adult: "Adulto",
  member: "Membro",
  child: "Criança",
}

export function House({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canInvite = me.user.role === "owner"
  const canAddCar = me.user.role === "owner" || me.user.role === "adult"

  const load = useCallback(async () => {
    const result = await fetchHousehold()
    if (result.kind === "unauthorized") {
      onSignedOut()
      return
    }
    if (result.kind === "error") {
      setError(result.message ?? "Não foi possível carregar a casa.")
      return
    }
    setError(null)
    setMembers(result.members)
    setVehicles(result.vehicles)
  }, [onSignedOut])

  useEffect(() => {
    void load()
  }, [load])

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const role = data.get("role")
    if (role !== "adult" && role !== "member" && role !== "child") return
    setBusy(true)
    setError(null)
    const result = await addMember({ displayName: String(data.get("displayName") ?? ""), role })
    setBusy(false)
    if (result.kind === "unauthorized") {
      onSignedOut()
      return
    }
    if (result.kind === "error") {
      setError(result.message ?? "Não foi possível adicionar.")
      return
    }
    setCode(result.code)
    event.currentTarget.reset()
    await load()
  }

  async function car(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const result = await addVehicle({
      name: String(data.get("name") ?? ""),
      alias: String(data.get("alias") ?? ""),
    })
    setBusy(false)
    if (result.kind === "unauthorized") {
      onSignedOut()
      return
    }
    if (result.kind === "error") {
      setError(result.message ?? "Não foi possível guardar o carro.")
      return
    }
    event.currentTarget.reset()
    await load()
  }

  return (
    <div className="screen">
      <section>
        <h2>Pessoas</h2>
        <ul className="inset">
          {members.map((member) => (
            <li key={member.id}>
              <span>{member.displayName}</span>
              <span className="meta">{ROLE_LABEL[member.role]}</span>
            </li>
          ))}
        </ul>
        {canInvite && (
          <form className="inset form" onSubmit={(event: FormEvent<HTMLFormElement>) => void invite(event)}>
            <label>
              Nome
              <input name="displayName" required />
            </label>
            <label>
              Papel
              <select name="role" defaultValue="adult">
                <option value="adult">Adulto</option>
                <option value="member">Membro</option>
                <option value="child">Criança</option>
              </select>
            </label>
            <button type="submit" className="filled" disabled={busy}>
              Adicionar
            </button>
          </form>
        )}
        {code && <p className="footnote">Código para esta pessoa entrar: {code}. Mostra-se só agora.</p>}
      </section>
      <section>
        <h2>Carros</h2>
        {vehicles.length === 0 ? (
          <p className="footnote">Ainda não há carros.</p>
        ) : (
          <ul className="inset">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <span>{vehicle.name}</span>
              </li>
            ))}
          </ul>
        )}
        {canAddCar && (
          <form className="inset form" onSubmit={(event: FormEvent<HTMLFormElement>) => void car(event)}>
            <label>
              Nome
              <input name="name" placeholder="Hyundai i30" required />
            </label>
            <label>
              Como lhe chamam
              <input name="alias" placeholder="i30" />
            </label>
            <button type="submit" className="filled" disabled={busy}>
              Guardar
            </button>
          </form>
        )}
      </section>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
