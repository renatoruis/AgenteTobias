import type { Role } from "../domain/types"

export type { EventSummary, MessageResponse, Role } from "../domain/types"

export type Me = {
  user: { id: string; displayName: string; role: Role }
  household: {
    id: string
    name: string
    timezone: string
    currency: string
    locale: string
  }
}

export type Reminder = {
  id: string
  title: string
  dueAt: string
  audience: string
  eventId: string
}
