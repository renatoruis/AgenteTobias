import { useCallback, useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"
import {
  fetchMe,
  fetchReminders,
  logout,
  postMessage,
  settledMessages,
  voidEvent,
} from "./requests"
import type { SendResult } from "./requests"
import { formatCivilDate } from "./format"
import { listMessages } from "./outbox"
import type { OutboxMessage } from "./outbox"
import type { Me, MessageResponse, Reminder } from "./types"
import { House } from "./House"
import { usePushToTalk } from "./usePushToTalk"
import { Welcome } from "./Welcome"

type ChatItem = {
  clientMessageId: string
  text: string
  queuedAt: number
  pending: boolean
  response: MessageResponse | null
  error: string | null
  actionError: string | null
  voidedEventIds: string[]
}

export function App() {
  useVisualViewport()
  const [phase, setPhase] = useState<"checking" | "out" | "in">("checking")
  const [me, setMe] = useState<Me | null>(null)
  const [bootMessage, setBootMessage] = useState<string | null>(null)

  const loadSession = useCallback(async () => {
    const result = await fetchMe()
    if (result.kind === "in") {
      setMe(result.me)
      setBootMessage(null)
      setPhase("in")
      return
    }
    setMe(null)
    setBootMessage(result.kind === "error" ? result.message : null)
    setPhase("out")
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  function leave() {
    setMe(null)
    setBootMessage(null)
    setPhase("out")
  }

  return (
    <div className="shell">
      {phase === "checking" && (
        <main className="entry">
          <h1>AgenteTobias</h1>
        </main>
      )}
      {phase === "out" && <Welcome message={bootMessage} onSuccess={() => void loadSession()} />}
      {phase === "in" && me && <Home me={me} onSignedOut={leave} />}
    </div>
  )
}

function Home({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [panel, setPanel] = useState<"chat" | "reminders" | "house">("chat")
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [draft, setDraft] = useState("")
  const [correction, setCorrection] = useState<{ eventId: string } | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [remindersReady, setRemindersReady] = useState(false)
  const [reminderError, setReminderError] = useState<string | null>(null)
  const conversationRef = useRef<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const onSignedOutRef = useRef(onSignedOut)
  onSignedOutRef.current = onSignedOut

  const talk = usePushToTalk(() => onSignedOutRef.current())

  const loadReminders = useCallback(async () => {
    const result = await fetchReminders()
    if (result.kind === "unauthorized") {
      onSignedOutRef.current()
      return
    }
    if (result.kind === "error") {
      if (result.message) setReminderError(result.message)
      return
    }
    setReminderError(null)
    setReminders(result.reminders)
    setRemindersReady(true)
  }, [])

  const applyResult = useCallback((clientMessageId: string, result: SendResult) => {
    if (result.kind === "unauthorized") {
      onSignedOutRef.current()
      return
    }
    if (result.kind === "ok" && result.response.conversationId) {
      conversationRef.current = result.response.conversationId
    }
    setMessages((prev) =>
      prev.map((item) => {
        if (item.clientMessageId !== clientMessageId) return item
        if (result.kind === "queued") return { ...item, pending: true }
        if (result.kind === "ok") return { ...item, pending: false, response: result.response, error: null }
        if (result.kind === "error") return { ...item, pending: false, error: result.message }
        return item
      }),
    )
    if (result.kind === "ok") void loadReminders()
  }, [loadReminders])

  const flush = useCallback(async () => {
    if (!navigator.onLine) return
    const queued = await listMessages()
    for (const item of queued) {
      const result = await postMessage({
        ...item,
        conversationId: item.conversationId ?? conversationRef.current,
      })
      applyResult(item.clientMessageId, result)
      if (result.kind === "queued" || result.kind === "unauthorized") return
    }
  }, [applyResult])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const queued = await listMessages()
      if (cancelled) return
      const knownConversation = queued.find((item) => item.conversationId)?.conversationId
      if (knownConversation) conversationRef.current = knownConversation
      setMessages((prev) => mergeMessages(prev, queued))
      await flush()
      if (!cancelled) await loadReminders()
    })()
    return () => {
      cancelled = true
    }
  }, [flush, loadReminders])

  useEffect(() => {
    const onOnline = () => {
      void flush()
    }
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
  }, [flush])

  useEffect(() => {
    if (panel === "chat") endRef.current?.scrollIntoView({ block: "end" })
  }, [messages, panel])

  function submitText(text: string, correctsEventId?: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const item: ChatItem = {
      clientMessageId: crypto.randomUUID(),
      text: trimmed,
      queuedAt: Date.now(),
      pending: true,
      response: null,
      error: null,
      actionError: null,
      voidedEventIds: [],
    }
    setMessages((prev) => [...prev, item].sort((a, b) => a.queuedAt - b.queuedAt))
    setPanel("chat")
    const payload: OutboxMessage = {
      clientMessageId: item.clientMessageId,
      text: trimmed,
      queuedAt: item.queuedAt,
      conversationId: conversationRef.current,
      correctsEventId,
    }
    void postMessage(payload).then((result) => applyResult(item.clientMessageId, result))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const correctsEventId = correction?.eventId
    submitText(draft, correctsEventId)
    setDraft("")
    setCorrection(null)
  }

  function registerTranscript() {
    if (talk.transcript === null) return
    submitText(talk.transcript)
    talk.setTranscript(null)
  }

  async function undo(eventId: string, clientMessageId: string) {
    const result = await voidEvent(eventId)
    if (result.kind === "unauthorized") {
      onSignedOut()
      return
    }
    if (result.kind === "error") {
      if (result.message) {
        setMessages((prev) =>
          prev.map((item) => (item.clientMessageId === clientMessageId ? { ...item, actionError: result.message } : item)),
        )
      }
      return
    }
    setMessages((prev) =>
      prev.map((item) =>
        item.clientMessageId === clientMessageId
          ? { ...item, actionError: null, voidedEventIds: [...item.voidedEventIds, eventId] }
          : item,
      ),
    )
  }

  function edit(eventId: string, text: string) {
    setCorrection({ eventId })
    setDraft(text)
    setPanel("chat")
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function signOut() {
    await logout()
    onSignedOut()
  }

  return (
    <>
      <header className="nav">
        <h1>{panel === "house" ? "Casa" : panel === "reminders" ? "Lembretes" : "Conversar"}</h1>
        <button type="button" className="text" onClick={() => void signOut()}>
          Sair
        </button>
      </header>
      <div className="main">
        {panel === "chat" ? (
          <div className="turns" role="log" aria-live="polite">
            {messages.map((item) => (
              <article key={item.clientMessageId} className="turn">
                <p className="bubble user">{item.text}</p>
                {item.pending && <p className="bubble agent">A registar…</p>}
                {!item.pending && item.error && (
                  <p className="bubble agent alert" role="alert">
                    {item.error}
                  </p>
                )}
                {!item.pending && item.response && (
                  <div className="bubble agent">
                    <p className="reply">{item.response.reply}</p>
                    {item.response.status === "interpreted" &&
                      item.response.events.map((event) => (
                        <div key={event.id} className="event-actions">
                          {item.response && item.response.events.length > 1 && (
                            <p className="event-summary">{event.summary}</p>
                          )}
                          {item.voidedEventIds.includes(event.id) ? (
                            <p className="voided">Anulado</p>
                          ) : (
                            <div className="actions">
                              <button type="button" className="ghost" onClick={() => void undo(event.id, item.clientMessageId)}>
                                Desfazer
                              </button>
                              <button type="button" className="ghost" onClick={() => edit(event.id, item.text)}>
                                Editar
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    {item.actionError && (
                      <p className="alert" role="alert">
                        {item.actionError}
                      </p>
                    )}
                  </div>
                )}
              </article>
            ))}
            <div ref={endRef} />
          </div>
        ) : panel === "house" ? (
          <House me={me} onSignedOut={onSignedOut} />
        ) : reminderError ? (
          <p className="alert" role="alert">
            {reminderError}
          </p>
        ) : remindersReady && reminders.length === 0 ? (
          <p className="empty">Sem lembretes.</p>
        ) : (
          <ul className="reminders">
            {reminders.map((reminder) => (
              <li key={reminder.id}>
                <p className="reminder-title">{reminder.title}</p>
                <p className="reminder-date">{formatCivilDate(reminder.dueAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {panel === "chat" && (
      <div className="composer">
        <button
          type="button"
          className={talk.listening ? "talk talk-on" : "talk"}
          aria-label="Falar"
          aria-pressed={talk.listening}
          onPointerDown={talk.onPointerDown}
          onPointerUp={talk.onPointerUp}
          onPointerCancel={talk.onPointerUp}
          onContextMenu={talk.onContextMenu}
        >
          {talk.listening ? "A ouvir…" : "Falar"}
        </button>
        {talk.hint && (
          <p className="hint" role="status">
            {talk.hint}
          </p>
        )}
        {talk.transcript !== null && (
          <div className="transcript">
            <label htmlFor="transcript">Transcrição</label>
            <textarea
              id="transcript"
              value={talk.transcript}
              onChange={(event: { target: { value: string } }) => talk.setTranscript(event.target.value)}
            />
            <button
              type="button"
              className="primary"
              onClick={registerTranscript}
              disabled={talk.transcript.trim() === ""}
            >
              Registar
            </button>
          </div>
        )}
        {correction && (
          <div className="correction">
            <span>A corrigir.</span>
            <button type="button" className="ghost" onClick={() => setCorrection(null)}>
              Cancelar
            </button>
          </div>
        )}
        <form onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="message">
            Mensagem
          </label>
          <input
            id="message"
            ref={inputRef}
            value={draft}
            enterKeyHint="send"
            autoCapitalize="sentences"
            autoCorrect="on"
            onChange={(event: { target: { value: string } }) => setDraft(event.target.value)}
          />
          <button type="submit" className="primary" disabled={draft.trim() === ""}>
            Enviar
          </button>
        </form>
      </div>
      )}
      <nav className="tabbar" aria-label="Secções">
        <button type="button" aria-selected={panel === "chat"} onClick={() => setPanel("chat")}>
          Conversar
        </button>
        <button
          type="button"
          aria-selected={panel === "reminders"}
          onClick={() => {
            setPanel("reminders")
            void loadReminders()
          }}
        >
          Lembretes
        </button>
        <button type="button" aria-selected={panel === "house"} onClick={() => setPanel("house")}>
          Casa
        </button>
      </nav>
    </>
  )
}

function mergeMessages(prev: ChatItem[], queued: OutboxMessage[]): ChatItem[] {
  const byId = new Map(prev.map((item) => [item.clientMessageId, item]))
  for (const item of settledMessages()) {
    const existing = byId.get(item.clientMessageId)
    byId.set(item.clientMessageId, {
      clientMessageId: item.clientMessageId,
      text: item.text,
      queuedAt: item.queuedAt,
      pending: false,
      response: item.response,
      error: item.error,
      actionError: existing?.actionError ?? null,
      voidedEventIds: existing?.voidedEventIds ?? [],
    })
  }
  for (const item of queued) {
    if (byId.has(item.clientMessageId)) continue
    byId.set(item.clientMessageId, {
      clientMessageId: item.clientMessageId,
      text: item.text,
      queuedAt: item.queuedAt,
      pending: true,
      response: null,
      error: null,
      actionError: null,
      voidedEventIds: [],
    })
  }
  return Array.from(byId.values()).sort((a, b) => a.queuedAt - b.queuedAt)
}

function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const apply = () => {
      document.documentElement.style.setProperty("--vvh", `${viewport.height}px`)
      document.documentElement.style.setProperty("--vv-top", `${viewport.offsetTop}px`)
    }
    apply()
    viewport.addEventListener("resize", apply)
    viewport.addEventListener("scroll", apply)
    return () => {
      viewport.removeEventListener("resize", apply)
      viewport.removeEventListener("scroll", apply)
    }
  }, [])
}
