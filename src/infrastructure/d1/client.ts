import { drizzle, type AnyD1Database } from "drizzle-orm/d1"
import * as schema from "./schema"

export function dbFrom(database: AnyD1Database) {
  return drizzle(database, { schema })
}

export type Database = ReturnType<typeof dbFrom>
