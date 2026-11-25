/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs. */
const files = new Map<string, string>()
jest.mock("../../shared/fs-safe", () => ({
  DOCUMENT_DIR: "file:///doc/",
  safeMakeDir: jest.fn(async () => undefined),
  safeDelete: jest.fn(async () => undefined),
  safeReadString: jest.fn(async (path: string) => files.get(path) ?? null),
  safeWriteString: jest.fn(async (path: string, content: string) => {
    files.set(path, content)
    return true
  }),
}))

import { writeResource } from "../../shared/cache/resource-cache"
import {
  CARD_REPEAT_MS,
  createCardRepeatFilter,
  dedupe,
  drain,
  enqueue,
  loadScanQueue,
  markedLine,
  pendingScans,
  refusedScans,
  saveScanQueue,
  scanQueueKey,
  type QueuedScan,
} from "./scan-queue"

const q = (card: string, error: string | null = null): QueuedScan => ({ card, error })
// The screen's classifier: a refusal keeps its message, anything else is the
// network.
class Refused extends Error {}
const offline = new Error("Network Error")
const refused = (message: string) => new Refused(message)
const refusal = (err: unknown): string | null =>
  err instanceof Refused ? err.message : null

beforeEach(() => files.clear())

describe("enqueue / dedupe", () => {
  it("adds a card once", () => {
    const one = enqueue([], "CS1.a")
    expect(enqueue(one, "CS1.a")).toEqual([q("CS1.a")])
    expect(enqueue(one, "CS1.b")).toEqual([q("CS1.a"), q("CS1.b")])
  })

  it("retries a refused card scanned again", () => {
    expect(enqueue([q("CS1.a", "Этого человека нет в клубе")], "CS1.a")).toEqual([
      q("CS1.a"),
    ])
  })

  it("keeps the first of repeated cards", () => {
    expect(dedupe([q("a"), q("b"), q("a", "x")])).toEqual([q("a"), q("b")])
  })

  it("splits waiting and refused cards", () => {
    const queue = [q("a"), q("b", "нет"), q("c")]
    expect(pendingScans(queue)).toEqual([q("a"), q("c")])
    expect(refusedScans(queue)).toEqual([q("b", "нет")])
  })
})

describe("drain", () => {
  it("sends every waiting card in order and empties the queue", async () => {
    const sent: string[] = []
    const out = await drain(
      [q("a"), q("b")],
      async (card) => {
        sent.push(card)
      },
      refusal,
    )
    expect(sent).toEqual(["a", "b"])
    expect(out).toEqual({ queue: [], sent: 2 })
  })

  it("keeps a refused card with the server's text and goes on", async () => {
    const out = await drain(
      [q("a"), q("b")],
      async (card) => {
        if (card === "a") throw refused("Этого человека нет в клубе")
      },
      refusal,
    )
    expect(out).toEqual({ queue: [q("a", "Этого человека нет в клубе")], sent: 1 })
  })

  it("stops at a network failure and keeps the rest waiting", async () => {
    const send = jest.fn(async () => {
      throw offline
    })
    const out = await drain([q("a"), q("b")], send, refusal)
    expect(send).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ queue: [q("a"), q("b")], sent: 0 })
  })

  it("skips cards refused before", async () => {
    const send = jest.fn(async () => undefined)
    const out = await drain([q("a", "нет"), q("b")], send, refusal)
    expect(send).toHaveBeenCalledWith("b")
    expect(send).toHaveBeenCalledTimes(1)
    expect(out.queue).toEqual([q("a", "нет")])
  })
})

describe("persistence", () => {
  it("round-trips per session", async () => {
    await saveScanQueue("s1", [q("a"), q("b", "нет")])
    expect(await loadScanQueue("s1")).toEqual([q("a"), q("b", "нет")])
    expect(await loadScanQueue("s2")).toEqual([])
  })

  it("drops malformed and repeated entries from storage", async () => {
    await writeResource(scanQueueKey("s1"), [q("a"), { card: 1 }, q("a"), "x"])
    expect(await loadScanQueue("s1")).toEqual([q("a")])
    await writeResource(scanQueueKey("s1"), { not: "a list" })
    expect(await loadScanQueue("s1")).toEqual([])
  })
})

describe("markedLine", () => {
  const abonement = (classesRemaining: number | null) =>
    ({ subscriptionId: "s", planName: "БЖЖ 12", classesRemaining }) as never

  it("names the pack and what is left", () => {
    expect(markedLine(abonement(7))).toBe("Отмечен · списано: БЖЖ 12, осталось 7")
  })

  it("only counts the visit on a time-based abonement", () => {
    expect(markedLine(abonement(null))).toBe("Отмечен · по абонементу «БЖЖ 12»")
  })

  it("is plain without an abonement", () => {
    expect(markedLine(null)).toBe("Отмечен")
  })
})

describe("createCardRepeatFilter", () => {
  it("counts a card held in view for 6 s once", () => {
    let t = 0
    const isNew = createCardRepeatFilter({ now: () => t })
    let sightings = 0
    for (t = 0; t <= 6000; t += 300) if (isNew("CS1.a")) sightings += 1
    expect(sightings).toBe(1)
  })

  it("counts it again after it was out of view longer than the window", () => {
    let t = 0
    const isNew = createCardRepeatFilter({ now: () => t })
    expect(isNew("CS1.a")).toBe(true)
    t = 1500
    expect(isNew("CS1.a")).toBe(false)
    t = 1500 + CARD_REPEAT_MS + 1
    expect(isNew("CS1.a")).toBe(true)
  })

  it("keeps cards apart", () => {
    const isNew = createCardRepeatFilter({ now: () => 0 })
    expect(isNew("CS1.a")).toBe(true)
    expect(isNew("CS1.b")).toBe(true)
    expect(isNew("CS1.a")).toBe(false)
  })
})
