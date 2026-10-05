export const MIN_HOLD_MS = 400
export const MAX_HOLD_MS = 60_000

export function shouldUploadAudio(holdMs: number): boolean {
  return holdMs >= MIN_HOLD_MS
}

/** Safari offers audio/mp4. Anything else records audio/webm. */
export function preferredAudioMime(): "audio/mp4" | "audio/webm" {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/mp4")) {
    return "audio/mp4"
  }
  return "audio/webm"
}
