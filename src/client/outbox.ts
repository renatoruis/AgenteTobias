export type OutboxMessage = {
  clientMessageId: string
  text: string
  queuedAt: number
  conversationId?: string
  correctsEventId?: string
}

const DB_NAME = "tobias"
const STORE = "outbox"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientMessageId" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function putMessage(message: OutboxMessage): Promise<void> {
  await withStore("readwrite", (store) => {
    store.put(message)
  })
}

export async function removeMessage(clientMessageId: string): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(clientMessageId)
  })
}

export async function listMessages(): Promise<OutboxMessage[]> {
  const rows = await withStore<OutboxMessage[]>("readonly", (store) => store.getAll())
  return (rows ?? []).slice().sort((a, b) => a.queuedAt - b.queuedAt)
}
