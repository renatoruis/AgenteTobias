import { z } from "zod"
import { parseEur } from "./money"
import { parseKilometers } from "./numbers"

export const roleSchema = z.enum(["owner", "adult", "member", "child"])
export const visibilitySchema = z.enum(["household", "adults", "private"])
export const eventStatusSchema = z.enum(["active", "voided", "superseded"])
export const eventTypeSchema = z.enum([
  "expense",
  "purchase",
  "vehicle.fuel",
  "vehicle.maintenance",
  "warranty",
  "object.location",
  "note",
  "incident",
  "reminder",
])
export const entityKindSchema = z.enum([
  "vehicle",
  "merchant",
  "appliance",
  "place",
  "person",
  "pet",
  "document",
  "other",
])
export const audienceSchema = z.enum(["household", "adults"])

const optionalText = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? undefined : value),
  z.string().trim().min(1).optional(),
)

const amountMinor = z.preprocess((value) => {
  if (typeof value === "string") {
    try {
      return parseEur(value)
    } catch {
      return value
    }
  }
  return value
}, z.int().nonnegative())

const optionalAmount = z.preprocess((value) => {
  if (value == null || value === "") return undefined
  if (typeof value === "string") {
    try {
      return parseEur(value)
    } catch {
      return value
    }
  }
  return value
}, z.int().nonnegative().optional())

const optionalKilometers = z.preprocess((value) => {
  if (value == null || value === "") return undefined
  if (typeof value === "string") {
    try {
      return parseKilometers(value)
    } catch {
      return value
    }
  }
  return value
}, z.int().nonnegative().optional())

const optionalLitros = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.number().nonnegative().optional(),
)

const optionalCurrency = z.literal("EUR").nullish()

const recordMeta = {
  occurredAt: z.string().trim().min(1),
  visibility: visibilitySchema,
  entityName: optionalText,
  entityKind: entityKindSchema.nullish(),
}

export const expenseDataSchema = z.object({
  amountMinor,
  currency: z.literal("EUR"),
  merchant: optionalText,
  note: optionalText,
})

export const purchaseDataSchema = z.object({
  amountMinor: optionalAmount,
  currency: optionalCurrency,
  product: optionalText,
})

export const vehicleFuelDataSchema = z.object({
  entityId: z.uuid(),
  litros: optionalLitros,
  km: optionalKilometers,
  posto: optionalText,
  amountMinor: optionalAmount,
  currency: optionalCurrency,
})

export const vehicleMaintenanceDataSchema = z.object({
  entityId: z.uuid(),
  amountMinor: optionalAmount,
  currency: optionalCurrency,
  note: optionalText,
})

export const warrantyDataSchema = z.object({
  warrantyMonths: z.int().positive(),
  entityId: z.uuid(),
  amountMinor: optionalAmount,
  currency: optionalCurrency,
})

export const objectLocationDataSchema = z.object({
  entityId: z.uuid(),
  place: z.string().trim().min(1),
  note: optionalText,
})

export const noteDataSchema = z.object({
  text: z.string().trim().min(1),
})

export const incidentDataSchema = z.object({
  text: z.string().trim().min(1),
})

export const reminderDataSchema = z.object({
  title: z.string().trim().min(1),
  dueAt: z.string().trim().min(1),
})

export const eventDataSchemas = {
  expense: expenseDataSchema,
  purchase: purchaseDataSchema,
  "vehicle.fuel": vehicleFuelDataSchema,
  "vehicle.maintenance": vehicleMaintenanceDataSchema,
  warranty: warrantyDataSchema,
  "object.location": objectLocationDataSchema,
  note: noteDataSchema,
  incident: incidentDataSchema,
  reminder: reminderDataSchema,
} as const

export const recordEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("expense"), ...recordMeta, data: expenseDataSchema }),
  z.object({ type: z.literal("purchase"), ...recordMeta, data: purchaseDataSchema }),
  z.object({ type: z.literal("vehicle.fuel"), ...recordMeta, data: vehicleFuelDataSchema }),
  z.object({ type: z.literal("vehicle.maintenance"), ...recordMeta, data: vehicleMaintenanceDataSchema }),
  z.object({ type: z.literal("warranty"), ...recordMeta, data: warrantyDataSchema }),
  z.object({ type: z.literal("object.location"), ...recordMeta, data: objectLocationDataSchema }),
  z.object({ type: z.literal("note"), ...recordMeta, data: noteDataSchema }),
  z.object({ type: z.literal("incident"), ...recordMeta, data: incidentDataSchema }),
  z.object({ type: z.literal("reminder"), ...recordMeta, data: reminderDataSchema }),
])

export const resolveOrCreateEntitySchema = z.object({
  kind: entityKindSchema,
  name: z.string().trim().min(1),
})

export const askClarificationSchema = z.object({
  question: z.string().trim().min(1),
})

export const searchEventsSchema = z.object({
  type: eventTypeSchema.optional(),
  entityId: z.uuid().optional(),
  entityName: optionalText,
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  amountMinor: optionalAmount,
})

export const searchTextSchema = z.object({
  query: z.string().trim().min(1),
})

export const voidEventSchema = z.object({
  eventId: z.uuid(),
})

export const createReminderSchema = z.object({
  title: z.string().trim().min(1),
  dueAt: z.string().trim().min(1),
  audience: audienceSchema,
  eventId: z.uuid().nullish(),
})

export const attachFileSchema = z.object({
  fileId: z.uuid(),
})

export const toolSchemas = {
  record_event: recordEventSchema,
  resolve_or_create_entity: resolveOrCreateEntitySchema,
  ask_clarification: askClarificationSchema,
  search_events: searchEventsSchema,
  search_text: searchTextSchema,
  void_event: voidEventSchema,
  create_reminder: createReminderSchema,
  attach_file: attachFileSchema,
} as const

export type ToolName = keyof typeof toolSchemas
export type RecordEventInput = z.infer<typeof recordEventSchema>
export type ResolveOrCreateEntityInput = z.infer<typeof resolveOrCreateEntitySchema>
export type AskClarificationInput = z.infer<typeof askClarificationSchema>
export type SearchEventsInput = z.infer<typeof searchEventsSchema>
export type SearchTextInput = z.infer<typeof searchTextSchema>
export type VoidEventInput = z.infer<typeof voidEventSchema>
export type CreateReminderInput = z.infer<typeof createReminderSchema>
export type AttachFileInput = z.infer<typeof attachFileSchema>

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(toolSchemas, name)
}

export function parseTool(name: string, input: unknown) {
  if (!isToolName(name)) return { success: false as const, error: "unknown_tool" as const }
  const parsed = toolSchemas[name].safeParse(input)
  if (!parsed.success) return { success: false as const, error: "validation" as const }
  return { success: true as const, name, data: parsed.data }
}
