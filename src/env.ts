export type Env = {
  DB: D1Database
  FILES: R2Bucket
  CONFIRM_ABOVE_MINOR?: string
  BOOTSTRAP_TOKEN: string
  PIN_PEPPER: string
}
