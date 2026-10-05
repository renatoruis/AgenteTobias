import { useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, SyntheticEvent } from "react"
import { postSpeech } from "./requests"
import { MAX_HOLD_MS, preferredAudioMime, shouldUploadAudio } from "./speech"

const VOICE_FAILED = "A voz falhou. Podes escrever."
const TOO_SHORT = "Segura um pouco mais."

type ActiveRecording = {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  startedAt: number
  timer: number
  stopping: boolean
}

export function usePushToTalk(onUnauthorized: () => void) {
  const [listening, setListening] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const holdingRef = useRef(false)
  const pressedAtRef = useRef(0)
  const startingRef = useRef(false)
  const recordingRef = useRef<ActiveRecording | null>(null)
  const finishRef = useRef<(released: boolean) => void>(() => {})
  const unauthorizedRef = useRef(onUnauthorized)
  unauthorizedRef.current = onUnauthorized

  function stopTracks(stream: MediaStream) {
    stream.getTracks().forEach((track) => track.stop())
  }

  async function upload(blob: Blob, mime: string) {
    const result = await postSpeech(blob, mime)
    if (result.kind === "ok") {
      setTranscript(result.transcript)
      setHint(null)
      return
    }
    if (result.kind === "unauthorized") {
      if (result.message) setHint(result.message)
      unauthorizedRef.current()
      return
    }
    if (result.kind === "unavailable") {
      setHint(VOICE_FAILED)
      return
    }
    if (result.message) setHint(result.message)
  }

  function finish(released: boolean) {
    const active = recordingRef.current
    if (!active || active.stopping) return
    active.stopping = true
    window.clearTimeout(active.timer)
    const holdMs = performance.now() - active.startedAt
    const uploadAudio = released && shouldUploadAudio(holdMs)

    const done = () => {
      stopTracks(active.stream)
      if (recordingRef.current === active) recordingRef.current = null
      setListening(false)
      if (!uploadAudio) {
        if (released && !shouldUploadAudio(holdMs)) setHint(TOO_SHORT)
        return
      }
      const mime = active.recorder.mimeType || preferredAudioMime()
      void upload(new Blob(active.chunks, { type: mime }), mime)
    }

    active.recorder.addEventListener("stop", done, { once: true })
    if (active.recorder.state === "recording") {
      try {
        active.recorder.stop()
        return
      } catch {
        // stop() failed; drop the clip below.
      }
    }
    active.recorder.removeEventListener("stop", done)
    done()
  }

  finishRef.current = finish

  async function begin() {
    if (recordingRef.current || startingRef.current) return
    startingRef.current = true
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      startingRef.current = false
      setHint(VOICE_FAILED)
      return
    }

    if (!holdingRef.current) {
      stopTracks(stream)
      startingRef.current = false
      if (!shouldUploadAudio(performance.now() - pressedAtRef.current)) setHint(TOO_SHORT)
      return
    }

    const mime = preferredAudioMime()
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime })
    } catch {
      try {
        recorder = new MediaRecorder(stream)
      } catch {
        stopTracks(stream)
        startingRef.current = false
        setHint(VOICE_FAILED)
        return
      }
    }

    const chunks: Blob[] = []
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })

    const active: ActiveRecording = {
      recorder,
      stream,
      chunks,
      startedAt: performance.now(),
      timer: window.setTimeout(() => finishRef.current(true), MAX_HOLD_MS),
      stopping: false,
    }
    recordingRef.current = active
    startingRef.current = false

    try {
      recorder.start()
    } catch {
      window.clearTimeout(active.timer)
      stopTracks(stream)
      recordingRef.current = null
      setHint(VOICE_FAILED)
      return
    }

    setListening(true)
    setHint(null)
    if (!holdingRef.current) finishRef.current(true)
  }

  useEffect(() => {
    return () => {
      const active = recordingRef.current
      if (!active) return
      window.clearTimeout(active.timer)
      stopTracks(active.stream)
      if (active.recorder.state !== "inactive") {
        try {
          active.recorder.stop()
        } catch {
          // already stopped
        }
      }
    }
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return
    holdingRef.current = true
    pressedAtRef.current = performance.now()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // The pointer can end before capture.
    }
    void begin()
  }

  function onPointerUp() {
    holdingRef.current = false
    finishRef.current(true)
  }

  return {
    listening,
    hint,
    transcript,
    setTranscript,
    onPointerDown,
    onPointerUp,
    onContextMenu: (event: SyntheticEvent) => event.preventDefault(),
  }
}
