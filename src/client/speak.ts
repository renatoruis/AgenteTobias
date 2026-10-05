const KEY = "tobias.speak"

export function speechEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setSpeechEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    // Private mode can block storage. The toggle still works for this visit.
  }
  if (!on) window.speechSynthesis?.cancel()
}

export function unlockSpeech(): void {
  if (!speechEnabled() || !window.speechSynthesis) return
  const utterance = new SpeechSynthesisUtterance(" ")
  utterance.volume = 0
  utterance.lang = "pt-PT"
  window.speechSynthesis.speak(utterance)
}

export function speakReply(text: string): void {
  if (!speechEnabled() || !text.trim() || !window.speechSynthesis) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = "pt-PT"
  const voices = synth.getVoices()
  const voice =
    voices.find((item) => item.lang.toLowerCase() === "pt-pt") ??
    voices.find((item) => item.lang.toLowerCase().startsWith("pt"))
  if (voice) utterance.voice = voice
  synth.speak(utterance)
}
