export function bytesToHex(bytes: Uint8Array): string {
  let hex = ""
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0")
  return hex
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4))
  return base64ToBytes(normalized + pad)
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

export function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(new TextEncoder().encode(left), new TextEncoder().encode(right))
}
