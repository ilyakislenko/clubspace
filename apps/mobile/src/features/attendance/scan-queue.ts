import type { VisitAbonement } from "../../shared/api/attendance"
import { readResource, writeResource } from "../../shared/cache/resource-cache"

// Cards the coach scanned while the phone had no connection, per session,
// kept on the device until they can be sent. Raw card strings only: nothing
// is marked locally, the server decides when the card goes through (lookup,
// then the regular mark). A card the server later refuses stays in the list
// with its error until the coach dismisses it.
export type QueuedScan = { card: string; error: string | null }

export const scanQueueKey = (sessionId: string): string =>
  `scan-queue:${sessionId}`

/** One entry per card, first occurrence kept. */
export const dedupe = (queue: readonly QueuedScan[]): QueuedScan[] => {
  const seen = new Set<string>()
  return queue.filter((s) => {
    if (seen.has(s.card)) return false
    seen.add(s.card)
    return true
  })
}

/**
 * Queues a card unless it already waits; a card refused before is queued
 * again (scanned anew = the coach wants another try).
 */
export const enqueue = (
  queue: readonly QueuedScan[],
  card: string,
): QueuedScan[] => [
  ...queue.filter((s) => s.card !== card),
  { card, error: null },
]

export const pendingScans = (queue: readonly QueuedScan[]): QueuedScan[] =>
  queue.filter((s) => s.error === null)

export const refusedScans = (queue: readonly QueuedScan[]): QueuedScan[] =>
  queue.filter((s) => s.error !== null)

/**
 * Sends the waiting cards in order. `lookupAndMark` resolves once the server
 * took the card (marked, or already marked) and throws otherwise; `refusal`
 * turns a thrown error into the text to keep beside a refused card, or null
 * for a network failure — the drain then stops and the rest keep waiting.
 */
export const drain = async (
  queue: readonly QueuedScan[],
  lookupAndMark: (card: string) => Promise<void>,
  refusal: (err: unknown) => string | null,
): Promise<{ queue: QueuedScan[]; sent: number }> => {
  const next = [...queue]
  let sent = 0
  for (const item of queue) {
    if (item.error !== null) continue
    try {
      await lookupAndMark(item.card)
      next.splice(next.indexOf(item), 1)
      sent += 1
    } catch (err) {
      const message = refusal(err)
      if (message === null) break
      next[next.indexOf(item)] = { card: item.card, error: message }
    }
  }
  return { queue: next, sent }
}

const isQueuedScan = (v: unknown): v is QueuedScan =>
  typeof v === "object" &&
  v !== null &&
  "card" in v &&
  typeof v.card === "string" &&
  "error" in v &&
  (v.error === null || typeof v.error === "string")

export const loadScanQueue = async (sessionId: string): Promise<QueuedScan[]> => {
  const snap = await readResource<unknown>(scanQueueKey(sessionId))
  return Array.isArray(snap?.data) ? dedupe(snap.data.filter(isQueuedScan)) : []
}

export const saveScanQueue = async (
  sessionId: string,
  queue: readonly QueuedScan[],
): Promise<void> => {
  await writeResource(scanQueueKey(sessionId), queue)
}

/**
 * The result strip's line for a marked card: «Отмечен · списано: БЖЖ 12,
 * осталось 7»; a time-based abonement only counts the visit.
 */
export const markedLine = (abonement: VisitAbonement | null | undefined): string =>
  !abonement
    ? "Отмечен"
    : abonement.classesRemaining === null
      ? `Отмечен · по абонементу «${abonement.planName}»`
      : `Отмечен · списано: ${abonement.planName}, осталось ${abonement.classesRemaining}`

// The camera reports a card many times a second while it is in view.
export const CARD_REPEAT_MS = 2000

/**
 * Turns the camera's stream of reports into one sighting per card: true the
 * first time a card is seen, then false while it stays in view (every
 * report, early ones included, slides the window). The card counts again
 * only after it was out of view for `repeatMs` — so a card held up after
 * «Отменить» is not marked again.
 */
export const createCardRepeatFilter = ({
  repeatMs = CARD_REPEAT_MS,
  now = Date.now,
}: { repeatMs?: number; now?: () => number } = {}) => {
  const lastSeen = new Map<string, number>()
  return (data: string): boolean => {
    const at = now()
    const seen = lastSeen.get(data)
    lastSeen.set(data, at)
    return seen === undefined || at - seen >= repeatMs
  }
}
