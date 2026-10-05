export type Env = {
  DB: D1Database
  FILES: R2Bucket
  VECTORS: Vectorize
  AI: Ai
  AI_GATEWAY_ID: string
  AI_INTERPRET_MODEL: string
  AI_FALLBACK_MODEL?: string
  AI_STT_MODEL: string
  AI_EMBED_MODEL: string
  EMBEDDINGS: string
  CONFIRM_ABOVE_MINOR?: string
  APNS_BUNDLE_ID: string
  BOOTSTRAP_TOKEN: string
  PIN_PEPPER: string
  APNS_TEAM_ID?: string
  APNS_KEY_ID?: string
  APNS_AUTH_KEY?: string
}
