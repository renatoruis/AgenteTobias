import { z } from "zod"
import { parseEur } from "./money"

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
  "income",
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

/** Empty strings and nulls become undefined so the model can send "" for a field it does not know. */
const optionalText = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? undefined : value),
  z.string().trim().min(1).optional(),
)

/** Integer cents, or text like "80 euros" / "70,50" that `parseEur` understands. */
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

const optionalMonths = z.preprocess((value) => {
  if (value == null || value === "") return undefined
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim())
  return value
}, z.int().positive().max(1200).optional())

const optionalLimit = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z.int().min(1).max(12).optional(),
)

export const entityRefSchema = z.object({
  name: z.string().trim().min(1),
  kind: entityKindSchema,
})

const memoryFields = {
  text: z.string().trim().min(1),
  type: eventTypeSchema,
  occurredAt: optionalText,
  amountMinor: optionalAmount,
  entities: z.array(entityRefSchema).max(4).optional(),
  visibility: visibilitySchema.optional(),
  remindAt: optionalText,
  warrantyMonths: optionalMonths,
  place: optionalText,
  details: z.record(z.string(), z.unknown()).optional(),
}

export const rememberSchema = z.object(memoryFields)

export const recallSchema = z.object({
  query: optionalText,
  type: eventTypeSchema.optional(),
  entity: optionalText,
  from: optionalText,
  to: optionalText,
  limit: optionalLimit,
})

export const totalSchema = z.object({
  type: eventTypeSchema.optional(),
  entity: optionalText,
  from: optionalText,
  to: optionalText,
})

export const amendSchema = z.object({
  eventId: z.uuid(),
  ...memoryFields,
  text: optionalText,
  type: eventTypeSchema.optional(),
})

export const voidSchema = z.object({
  eventId: z.uuid(),
})

export const toolSchemas = {
  remember: rememberSchema,
  recall: recallSchema,
  total: totalSchema,
  amend: amendSchema,
  void: voidSchema,
} as const

export type ToolName = keyof typeof toolSchemas
export type RememberInput = z.infer<typeof rememberSchema>
export type RecallInput = z.infer<typeof recallSchema>
export type TotalInput = z.infer<typeof totalSchema>
export type AmendInput = z.infer<typeof amendSchema>
export type VoidInput = z.infer<typeof voidSchema>
export type EntityRef = z.infer<typeof entityRefSchema>

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(toolSchemas, name)
}

export function parseTool(name: string, input: unknown) {
  if (!isToolName(name)) return { success: false as const, error: "unknown_tool" as const }
  const parsed = toolSchemas[name].safeParse(input)
  if (!parsed.success) return { success: false as const, error: "validation" as const }
  return { success: true as const, name, data: parsed.data }
}
