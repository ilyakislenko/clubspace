/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs. */
// The card is cached through resource-cache, whose I/O goes through fs-safe:
// an in-memory store stands in for the file system (see resource-cache.spec).
const files = new Map<string, string>()
jest.mock("./fs-safe", () => ({
  DOCUMENT_DIR: "file:///doc/",
  safeMakeDir: jest.fn(async () => undefined),
  safeDelete: jest.fn(async (path: string) => {
    for (const key of [...files.keys()]) {
      if (key.startsWith(path)) files.delete(key)
    }
  }),
  safeReadString: jest.fn(async (path: string) => files.get(path) ?? null),
  safeWriteString: jest.fn(async (path: string, content: string) => {
    files.set(path, content)
    return true
  }),
}))

import { clearResourceCache, readResource, writeResource } from "./cache/resource-cache"
import {
  cardForViewer,
  cardUserId,
  checkInCardKey,
  checkInCardView,
} from "./check-in-card-store"
import { setProfileScopeId } from "./profile-scope"
import type { CheckInCard } from "./api/check-in-card"

const ANYA = "0b6f4a7e-2a55-4c1e-9f3a-1d2c3b4a5f60"
const PETR = "9d8c7b6a-5f4e-4d3c-8b2a-112233445566"
const card = (userId: string): CheckInCard => ({
  card: `CS1.${userId}.AbCdEfGh_-123456`,
  qrPngDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  name: "Аня Смирнова",
})

beforeEach(() => {
  files.clear()
  setProfileScopeId(null)
})

describe("checkInCardKey", () => {
  it("names the person", () => {
    expect(checkInCardKey(ANYA)).toBe(`check-in-card:${ANYA}`)
  })
})

describe("cardUserId", () => {
  it("reads the person of a ClubSpace card", () => {
    expect(cardUserId(card(ANYA).card)).toBe(ANYA)
  })

  it.each([
    ["another prefix", `CS2.${ANYA}.AbCdEfGh_-123456`],
    ["a short mac", `CS1.${ANYA}.AbCd`],
    ["extra segments", `CS1.${ANYA}.AbCdEfGh_-123456.x`],
    ["not a uuid", "CS1.anya.AbCdEfGh_-123456"],
    ["a URL", "https://clubspace.example/join/ABC"],
  ])("is null for %s", (_label, text) => {
    expect(cardUserId(text)).toBeNull()
  })
})

describe("cardForViewer", () => {
  it("shows the viewer's own card", () => {
    expect(cardForViewer(card(ANYA), ANYA)).toEqual(card(ANYA))
  })

  it("never shows someone else's card", () => {
    expect(cardForViewer(card(PETR), ANYA)).toBeNull()
  })

  it("waits for the viewer and drops a card without its picture", () => {
    expect(cardForViewer(card(ANYA), null)).toBeNull()
    expect(cardForViewer({ ...card(ANYA), qrPngDataUrl: "" }, ANYA)).toBeNull()
    expect(cardForViewer(null, ANYA)).toBeNull()
  })
})

describe("checkInCardView", () => {
  it("prefers the card, then the first read, then the offline line", () => {
    expect(checkInCardView({ card: card(ANYA), loading: true })).toBe("card")
    expect(checkInCardView({ card: null, loading: true })).toBe("loading")
    expect(checkInCardView({ card: null, loading: false })).toBe("unavailable")
  })
})

describe("persistence", () => {
  it("survives a restart under the person's key and is wiped on sign-out", async () => {
    await writeResource(checkInCardKey(ANYA), card(ANYA))
    const snap = await readResource<CheckInCard>(checkInCardKey(ANYA))
    expect(cardForViewer(snap?.data ?? null, ANYA)).toEqual(card(ANYA))
    expect(await readResource(checkInCardKey(PETR))).toBeNull()

    await clearResourceCache()
    expect(await readResource(checkInCardKey(ANYA))).toBeNull()
  })

  it("keeps a child's card in the child's profile", async () => {
    setProfileScopeId(PETR)
    await writeResource(checkInCardKey(PETR), card(PETR))
    setProfileScopeId(null)
    expect(await readResource(checkInCardKey(PETR))).toBeNull()
    setProfileScopeId(PETR)
    expect((await readResource(checkInCardKey(PETR)))?.data).toEqual(card(PETR))
  })
})
