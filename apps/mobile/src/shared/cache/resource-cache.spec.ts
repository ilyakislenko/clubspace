/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs. */
// All of resource-cache's I/O — including where the cache directory lives —
// goes through fs-safe, which we mock with an in-memory store. That also keeps
// expo-file-system (native ESM) out of the import graph, so the suite runs
// under the non-expo jest preset.
const files = new Map<string, string>()
jest.mock("../fs-safe", () => ({
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

import {
  cacheFileName,
  clearResourceCache,
  readResource,
  writeResource,
} from "./resource-cache"
import { setProfileScopeId } from "../profile-scope"

beforeEach(() => {
  files.clear()
  setProfileScopeId(null)
})

describe("cacheFileName", () => {
  it("neutralizes path-unsafe characters", () => {
    expect(cacheFileName("announcements:abc-123")).toBe(
      "announcements_abc-123.json",
    )
    expect(cacheFileName("a/b\\c")).toBe("a_b_c.json")
  })
})

describe("read/write round-trip", () => {
  it("returns null before anything is written", async () => {
    expect(await readResource("ranks:w1")).toBeNull()
  })

  it("round-trips data with a savedAt timestamp", async () => {
    await writeResource("ranks:w1", { current: [], history: [1, 2, 3] })
    const snap = await readResource<{ current: unknown[]; history: number[] }>(
      "ranks:w1",
    )
    expect(snap?.data).toEqual({ current: [], history: [1, 2, 3] })
    expect(typeof snap?.savedAt).toBe("number")
  })

  it("returns null for corrupt JSON", async () => {
    await writeResource("x:1", { a: 1 })
    // Corrupt the stored payload.
    const path = "file:///doc/resource-cache/x_1.json"
    files.set(path, "{ not json")
    expect(await readResource("x:1")).toBeNull()
  })

  it("clearResourceCache drops everything", async () => {
    await writeResource("a:1", { v: 1 })
    await writeResource("b:2", { v: 2 })
    await clearResourceCache()
    expect(await readResource("a:1")).toBeNull()
    expect(await readResource("b:2")).toBeNull()
  })
})

describe("per profile", () => {
  it("keeps a child's snapshot apart from the guardian's under the same key", async () => {
    await writeResource("subscription:w1", { owner: "guardian" })
    setProfileScopeId("kid-1")
    expect(await readResource("subscription:w1")).toBeNull()
    await writeResource("subscription:w1", { owner: "kid" })
    expect((await readResource("subscription:w1"))?.data).toEqual({
      owner: "kid",
    })
    expect(
      files.has("file:///doc/resource-cache/profiles/kid-1/subscription_w1.json"),
    ).toBe(true)
    setProfileScopeId(null)
    expect((await readResource("subscription:w1"))?.data).toEqual({
      owner: "guardian",
    })
  })

  it("clearResourceCache drops every profile's snapshots", async () => {
    await writeResource("a:1", { v: 1 })
    setProfileScopeId("kid-1")
    await writeResource("a:1", { v: 2 })
    await clearResourceCache()
    expect(await readResource("a:1")).toBeNull()
    setProfileScopeId(null)
    expect(await readResource("a:1")).toBeNull()
  })
})
