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
  occurredOn?: string | null
  todayOn?: string | null
  summary?: string | null
}

export function replyFor(event: ReplyEvent): string {
  const name = eventName(event)
  const money = event.amountMinor == null ? null : formatEur(event.amountMinor)
  const warranty = formatWarrantyDate(event.warrantyEndsOn)

  if (event.type === "expense") {
    if (money && name) return withDay(`Registrei ${money} no ${name}.`, event)
    if (money) return withDay(`Registrei ${money}.`, event)
    if (name) return withDay(`Registrei a despesa no ${name}.`, event)
    return withDay("Registrei a despesa.", event)
  }

  if (event.type === "vehicle.fuel") {
    if (money && name) return withDay(`Registrei ${money} de combustível no ${name}.`, event)
    if (name) return withDay(`Registrei combustível no ${name}.`, event)
    if (money) return withDay(`Registrei ${money} de combustível.`, event)
    return withDay("Registrei combustível.", event)
  }

  if (event.type === "warranty" || (event.type === "purchase" && warranty)) {
    const label = name ?? "compra"
    if (warranty) return `Registrei a ${label}, garantia até ${warranty}.`
    return `Registrei a ${label}.`
  }

  if (event.type === "purchase") {
    if (money && name) return withDay(`Registrei ${money} na ${name}.`, event)
    if (name) return withDay(`Registrei a ${name}.`, event)
    if (money) return withDay(`Registrei ${money}.`, event)
    return withDay("Registrei a compra.", event)
  }

  if (event.type === "vehicle.maintenance") {
    if (money && name) return withDay(`Registrei ${money} de manutenção no ${name}.`, event)
    if (name) return withDay(`Registrei a manutenção no ${name}.`, event)
    return withDay("Registrei a manutenção.", event)
  }

  if (event.type === "object.location") {
    if (name && event.place) return `Registrei ${name} em ${event.place}.`
    if (event.place) return `Registrei em ${event.place}.`
    return "Registrei o sítio."
  }

  if (event.type === "note") return quoted("Nota", event.text, event)
  if (event.type === "incident") return quoted("Incidente", event.text, event)
  if (event.type === "reminder") {
    const title = event.title?.trim()
    return title ? `Registrei o lembrete ${title}.` : "Registrei o lembrete."
  }

  return "Registrei."
}

export function proposalFor(event: ReplyEvent): string {
  if (event.type === "note" || event.type === "incident") {
    const body = event.text?.trim() || summaryFor(event)
    const day = formatWarrantyDate(event.occurredOn)
    const detail = day ? `«${body}», ${day}` : `«${body}»`
    return `Entendi: ${detail}. Gravo?`
  }
  const day = otherDay(event)
  const detail = day ? `${summaryFor(event)}, ${day}` : summaryFor(event)
  return `Entendi: ${detail}. Gravo?`
}

export function confirmPhrase(text: string): "yes" | "no" | null {
  const folded = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[?!.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (folded === "sim" || folded === "grava" || folded === "podes gravar" || folded === "confirma") return "yes"
  if (folded === "nao" || folded === "deixa" || folded === "nao graves" || folded === "nao grava") return "no"
  return null
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

function quoted(label: string, text: string | null | undefined, event: ReplyEvent): string {
  const body = text?.trim()
  const day = formatWarrantyDate(event.occurredOn)
  if (body && day) return `${label}: «${body}», ${day}.`
  if (body) return `${label}: «${body}».`
  return label === "Nota" ? "Registrei a nota." : "Registrei o incidente."
}

function withDay(sentence: string, event: ReplyEvent): string {
  const day = otherDay(event)
  if (!day) return sentence
  return `${sentence.replace(/\.$/, "")}, ${day}.`
}

function otherDay(event: ReplyEvent): string | null {
  if (!event.occurredOn || event.occurredOn === event.todayOn) return null
  return formatWarrantyDate(event.occurredOn)
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
