// The web build's entire local-persistence layer runs through this file — the
// offline cache, resume positions, the outbox and every preference. It has to
// answer like the native helper it stands in for, including directory
// semantics, or callers silently lose data in the browser.

type Entry = [string, string]

class FakeStorage {
  private entries = new Map<string, string>()
  private failWrites = false

  get length() {
    return this.entries.size
  }
  key(i: number) {
    return [...this.entries.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.entries.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.failWrites) {
      const error = new Error("quota") as Error & { name: string }
      error.name = "QuotaExceededError"
      throw error
    }
    this.entries.set(k, v)
  }
  removeItem(k: string) {
    this.entries.delete(k)
  }
  /** Reject writes until enough bytes have been evicted. */
  fillUp() {
    this.failWrites = true
  }
  relieve() {
    this.failWrites = false
  }
  all(): Entry[] {
    return [...this.entries.entries()]
  }
}

let storage: FakeStorage
let fs: typeof import("./fs-safe.web")

beforeEach(async () => {
  storage = new FakeStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  jest.resetModules()
  fs = await import("./fs-safe.web")
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe("read/write", () => {
  it("round-trips a value", async () => {
    expect(await fs.safeWriteString("app/outbox.json", "[]")).toBe(true)
    expect(await fs.safeReadString("app/outbox.json")).toBe("[]")
  })

  it("returns null for a path that was never written", async () => {
    expect(await fs.safeReadString("app/missing.json")).toBeNull()
  })

  it("namespaces its keys so it can't collide with the token store", async () => {
    await fs.safeWriteString("app/outbox.json", "[]")
    expect(storage.all().map(([key]) => key)).toEqual(["clubspacefs:app/outbox.json"])
  })
})

describe("getInfo", () => {
  it("reports a written file as existing", async () => {
    await fs.safeWriteString("app/prefs/preferences.json", "{}")
    const info = await fs.safeGetInfo("app/prefs/preferences.json")
    expect(info.exists).toBe(true)
    expect(info.isDirectory).toBe(false)
  })

  it("reports a directory as existing once something lives under it", async () => {
    expect((await fs.safeGetInfo("app/prefs/")).exists).toBe(false)
    await fs.safeWriteString("app/prefs/preferences.json", "{}")
    const info = await fs.safeGetInfo("app/prefs/")
    expect(info.exists).toBe(true)
    expect(info.isDirectory).toBe(true)
  })
})

describe("delete", () => {
  it("removes a single file", async () => {
    await fs.safeWriteString("app/outbox.json", "[]")
    await fs.safeDelete("app/outbox.json")
    expect(await fs.safeReadString("app/outbox.json")).toBeNull()
  })

  it("wipes a whole directory — sign-out must not leave another member's cache", async () => {
    await fs.safeWriteString("app/resource-cache/a.json", "1")
    await fs.safeWriteString("app/resource-cache/b.json", "2")
    await fs.safeWriteString("app/prefs/preferences.json", "keep")

    await fs.safeDelete("app/resource-cache/")

    expect(await fs.safeReadString("app/resource-cache/a.json")).toBeNull()
    expect(await fs.safeReadString("app/resource-cache/b.json")).toBeNull()
    expect(await fs.safeReadString("app/prefs/preferences.json")).toBe("keep")
  })
})

describe("listDir", () => {
  it("returns immediate child names, not full paths", async () => {
    await fs.safeWriteString("app/videos/one.mp4", "x")
    await fs.safeWriteString("app/videos/two.mp4", "y")
    expect((await fs.safeListDir("app/videos/")).sort()).toEqual([
      "one.mp4",
      "two.mp4",
    ])
  })

  it("collapses nested paths to the first segment, like readDirectoryAsync", async () => {
    await fs.safeWriteString("app/videos/abc/index.m3u8", "x")
    await fs.safeWriteString("app/videos/abc/seg1.ts", "y")
    expect(await fs.safeListDir("app/videos/")).toEqual(["abc"])
  })

  it("is empty for a directory with nothing in it", async () => {
    expect(await fs.safeListDir("app/nothing/")).toEqual([])
  })
})

describe("quota exhaustion", () => {
  it("evicts the rebuildable API cache so a preference write still lands", async () => {
    await fs.safeWriteString("app/resource-cache/courses.json", "cached")
    await fs.safeWriteString("app/prefs/preferences.json", "old")
    storage.fillUp()
    // The retry after eviction must succeed, so let writes through again once
    // the cache has been cleared out.
    const originalSet = storage.setItem.bind(storage)
    let attempts = 0
    storage.setItem = (k: string, v: string) => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error("quota") as Error & { name: string }
        error.name = "QuotaExceededError"
        throw error
      }
      storage.relieve()
      originalSet(k, v)
    }

    expect(await fs.safeWriteString("app/prefs/preferences.json", "new")).toBe(
      true,
    )
    expect(await fs.safeReadString("app/resource-cache/courses.json")).toBeNull()
    expect(await fs.safeReadString("app/prefs/preferences.json")).toBe("new")
  })

  it("reports failure honestly when even eviction doesn't free enough", async () => {
    storage.fillUp()
    expect(await fs.safeWriteString("app/prefs/preferences.json", "x")).toBe(
      false,
    )
  })
})

describe("storage disabled (private mode)", () => {
  it("degrades to a no-op instead of throwing", async () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    jest.resetModules()
    const isolated = await import("./fs-safe.web")

    expect(await isolated.safeWriteString("app/a.json", "1")).toBe(false)
    expect(await isolated.safeReadString("app/a.json")).toBeNull()
    expect((await isolated.safeGetInfo("app/a.json")).exists).toBe(false)
    expect(await isolated.safeListDir("app/")).toEqual([])
    await expect(isolated.safeDelete("app/a.json")).resolves.toBeUndefined()
    await expect(isolated.safeMakeDir("app/")).resolves.toBeUndefined()
  })
})
