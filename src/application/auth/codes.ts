import { bytesToHex } from "./codec"

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const CODE_SECONDS = 7 * 24 * 60 * 60

export function generateCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let code = ""
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length]
  return code
}

export async function hashCode(kind: "invite" | "kiosk" | "mcp", code: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}:${pepper}:${code}`),
  )
  return bytesToHex(new Uint8Array(digest))
}
