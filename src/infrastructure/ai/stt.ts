import type { Env } from "../../env"

type BytesWithBase64 = Uint8Array & { toBase64?: () => string }

// Schema of @cf/openai/whisper-large-v3-turbo: `audio` is a base64 string
// or `{ body, contentType }`. The binding rejects a ReadableStream when the
// AI Gateway is set, so this call sends base64. `language` is the other field.
function encodeBase64(audio: ArrayBuffer): string {
  const bytes = new Uint8Array(audio) as BytesWithBase64
  if (typeof bytes.toBase64 === "function") return bytes.toBase64()

  const parts: string[] = []
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    const slice = bytes.subarray(offset, offset + chunk)
    parts.push(String.fromCharCode(...Array.from(slice)))
  }
  return btoa(parts.join(""))
}

export async function transcribe(env: Env, audio: ArrayBuffer, mime: string): Promise<string> {
  if (mime.length === 0) {
    throw new Error("mime")
  }

  const result = await env.AI.run(
    env.AI_STT_MODEL,
    { audio: encodeBase64(audio), language: "pt" },
    { gateway: { id: env.AI_GATEWAY_ID } },
  )

  if (typeof result !== "object" || result === null || !("text" in result)) {
    throw new Error("stt")
  }

  const text = (result as { text?: unknown }).text
  if (typeof text !== "string") {
    throw new Error("stt")
  }
  return text
}
