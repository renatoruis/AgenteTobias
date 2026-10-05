import { formatEur } from "./money"
import type { EventType } from "./types"

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const

export type ReplyEvent = {
  type: EventType
  amountMinor?: number | null
  currency?: string | null
  entityName?: string | null
  productName?: string | null
  place?: string | null
  text?: string | null
  title?: string | null
  warrantyEndsOn?: string | null
  summary?: string | null
}

export function replyFor(event: ReplyEvent): string {
  const name = eventName(event)
  const money = event.amountMinor == null ? null : formatEur(event.amountMinor)
  const warranty = formatWarrantyDate(event.warrantyEndsOn)

  if (event.type === "expense") {
    if (money && name) return `Registrei ${money} no ${name}.`
    if (money) return `Registrei ${money}.`
    if (name) return `Registrei a despesa no ${name}.`
    return "Registrei a despesa."
  }

  if (event.type === "vehicle.fuel") {
    if (money && name) return `Registrei ${money} de combustível no ${name}.`
    if (name) return `Registrei combustível no ${name}.`
    if (money) return `Registrei ${money} de combustível.`
    return "Registrei combustível."
  }

  if (event.type === "warranty" || (event.type === "purchase" && warranty)) {
    const label = name ?? "compra"
    if (warranty) return `Registrei a ${label}, garantia até ${warranty}.`
    return `Registrei a ${label}.`
  }

  if (event.type === "purchase") {
    if (money && name) return `Registrei ${money} na ${name}.`
    if (name) return `Registrei a ${name}.`
    if (money) return `Registrei ${money}.`
    return "Registrei a compra."
  }

  if (event.type === "vehicle.maintenance") {
    if (money && name) return `Registrei ${money} de manutenção no ${name}.`
    if (name) return `Registrei a manutenção no ${name}.`
    return "Registrei a manutenção."
  }

  if (event.type === "object.location") {
    if (name && event.place) return `Registrei ${name} em ${event.place}.`
    if (event.place) return `Registrei em ${event.place}.`
    return "Registrei o sítio."
  }

  if (event.type === "note") return "Registrei a nota."
  if (event.type === "incident") return "Registrei o incidente."
  if (event.type === "reminder") {
    const title = event.title?.trim()
    return title ? `Registrei o lembrete ${title}.` : "Registrei o lembrete."
  }

  return "Registrei."
}

export function summaryFor(event: ReplyEvent): string {
  const name = eventName(event)
  const money = event.amountMinor == null ? null : formatEur(event.amountMinor)
  const warranty = formatWarrantyDate(event.warrantyEndsOn)

  if (event.type === "expense") {
    if (money && name) return `${money} no ${name}`
    if (money) return money
    if (name) return name
    return "Despesa"
  }

  if (event.type === "vehicle.fuel") {
    if (money && name) return `${money} de combustível no ${name}`
    if (name) return `Combustível no ${name}`
    if (money) return `${money} de combustível`
    return "Combustível"
  }

  if (event.type === "warranty" || warranty) {
    const label = name ?? "compra"
    if (warranty) return `${label}, garantia até ${warranty}`
    return label
  }

  if (event.type === "purchase") {
    if (money && name) return `${money} na ${name}`
    return name ?? "Compra"
  }

  if (event.type === "vehicle.maintenance") {
    if (money && name) return `${money} de manutenção no ${name}`
    if (name) return `Manutenção no ${name}`
    return "Manutenção"
  }

  if (event.type === "object.location") {
    if (name && event.place) return `${name} em ${event.place}`
    return event.place ?? name ?? "Sítio"
  }

  if (event.type === "note") return event.text?.trim() || "Nota"
  if (event.type === "incident") return event.text?.trim() || "Incidente"
  if (event.type === "reminder") return event.title?.trim() || "Lembrete"
  return "Registo"
}

export function storedReply(): string {
  return "Guardado, ainda por interpretar."
}

export function replyForSum(totalMinor: number, entityName?: string | null): string {
  if (totalMinor === 0) {
    const name = entityName?.trim()
    return name ? `Não há despesas do ${name} este mês.` : "Não há despesas este mês."
  }
  return `${formatEur(totalMinor)} este mês.`
}

export function replyForClarification(first: string, second: string): string {
  return `Foi o ${first} ou o ${second}?`
}

export function missingAmountQuestion(): string {
  return "Qual foi o valor?"
}

function eventName(event: ReplyEvent): string | null {
  const name = event.productName?.trim() || event.entityName?.trim()
  return name ? name : null
}

function formatWarrantyDate(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const month = MONTHS[Number(match[2]) - 1]
  if (!month) return null
  return `${Number(match[3])} de ${month} de ${match[1]}`
}
