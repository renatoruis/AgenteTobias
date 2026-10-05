export type Role = "owner" | "adult" | "member" | "child"
export type Visibility = "household" | "adults" | "private"
export type EventStatus = "active" | "voided" | "superseded"
export type EventType =
  | "expense"
  | "purchase"
  | "vehicle.fuel"
  | "vehicle.maintenance"
  | "warranty"
  | "object.location"
  | "note"
  | "incident"
  | "reminder"

export type Session = {
  userId: string
  householdId: string
  role: Role
  deviceId: string
}

export type Money = { amountMinor: number; currency: "EUR" }

export type EventSummary = {
  id: string
  type: EventType
  occurredAt: string
  amountMinor: number | null
  currency: string | null
  summary: string
  warrantyEndsOn: string | null
}

export type MessageResponse = {
  messageId: string
  conversationId: string
  status: "interpreted" | "stored" | "clarification" | "proposal"
  reply: string
  events: EventSummary[]
  clarification: { question: string } | null
  idempotent: boolean
}
