import { getApiClient } from "../api/client"
import { DOCUMENT_DIR, safeReadString, safeWriteString } from "../fs-safe"

// A durable FIFO queue of write requests that failed because the device was
// offline. They're replayed in order when connectivity returns, so a coach can
// mark attendance on the gym floor with no signal and have it sync later.
// Only idempotent, replay-safe mutations belong here.

const FILE = `${DOCUMENT_DIR}outbox.json`

export type OutboxOp = {
  id: string
  label: string
  method: "post" | "put" | "patch" | "delete"
  url: string
  data?: unknown
  createdAt: number
}

let queue: OutboxOp[] | null = null
let flushing = false

const parse = (raw: string): OutboxOp[] => {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v as OutboxOp[]) : []
  } catch {
    return []
  }
}

const load = async (): Promise<OutboxOp[]> => {
  if (queue) return queue
  const raw = await safeReadString(FILE)
  queue = raw ? parse(raw) : []
  return queue
}

const persist = async () => {
  if (queue) await safeWriteString(FILE, JSON.stringify(queue))
}

// A 4xx means the request will never succeed on retry (bad input / gone / not
// allowed) — drop it. Network errors (no response) and 5xx are transient.
export const isPermanentError = (err: unknown): boolean => {
  const status = (err as { response?: { status?: number } } | null)?.response
    ?.status
  return typeof status === "number" && status >= 400 && status < 500
}

export const enqueue = async (
  op: Omit<OutboxOp, "id" | "createdAt">,
): Promise<void> => {
  const q = await load()
  q.push({
    ...op,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  })
  await persist()
}

export const pendingCount = async (): Promise<number> => (await load()).length

/**
 * Replay pending ops in order. Removes each on success; drops ops that fail
 * permanently (4xx); stops at the first transient failure (network / 5xx),
 * keeping it and the rest for the next flush. Reentrancy-guarded.
 */
export const flushOutbox = async (): Promise<void> => {
  if (flushing) return
  flushing = true
  try {
    const q = await load()
    while (q.length > 0) {
      const op = q[0]
      try {
        await getApiClient().request({
          method: op.method,
          url: op.url,
          data: op.data,
        })
        q.shift()
        await persist()
      } catch (err) {
        if (isPermanentError(err)) {
          q.shift()
          await persist()
          continue
        }
        break // transient — retry on the next flush
      }
    }
  } finally {
    flushing = false
  }
}

// For sign-out: forget any queued writes so they don't replay for another user.
export const clearOutbox = async (): Promise<void> => {
  queue = []
  await persist()
}
