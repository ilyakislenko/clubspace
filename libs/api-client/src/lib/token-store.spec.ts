import {
  createMemoryTokenStore,
  createStorageTokenStore,
  type KeyValueStorage,
} from "./token-store"

const makeStorage = (): KeyValueStorage & { data: Record<string, string> } => {
  const data: Record<string, string> = {}
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

describe("createMemoryTokenStore", () => {
  it("starts empty", () => {
    const s = createMemoryTokenStore()
    expect(s.getAccessToken()).toBeNull()
    expect(s.getRefreshToken()).toBeNull()
    expect(s.getExpiresAt()).toBeNull()
    expect(s.getUserId()).toBeNull()
  })

  it("round-trips each field", () => {
    const s = createMemoryTokenStore()
    s.setAccessToken("a")
    s.setRefreshToken("r")
    s.setExpiresAt(123)
    s.setUserId("u")
    expect(s.getAccessToken()).toBe("a")
    expect(s.getRefreshToken()).toBe("r")
    expect(s.getExpiresAt()).toBe(123)
    expect(s.getUserId()).toBe("u")
  })

  it("clear() resets ALL fields — not just the tokens", () => {
    // Regression guard: a stale expiresAt or userId surviving sign-out
    // breaks the next session's near-expiry refresh / leaks the prior user.
    const s = createMemoryTokenStore()
    s.setAccessToken("a")
    s.setRefreshToken("r")
    s.setExpiresAt(123)
    s.setUserId("u")
    void s.clear()
    expect(s.getAccessToken()).toBeNull()
    expect(s.getRefreshToken()).toBeNull()
    expect(s.getExpiresAt()).toBeNull()
    expect(s.getUserId()).toBeNull()
  })
})

describe("createStorageTokenStore", () => {
  it("reads/writes through the storage interface", () => {
    const storage = makeStorage()
    const s = createStorageTokenStore(storage)
    s.setAccessToken("a")
    s.setUserId("u")
    expect(storage.data.accessToken).toBe("a")
    expect(storage.data.userId).toBe("u")
    expect(s.getAccessToken()).toBe("a")
    expect(s.getUserId()).toBe("u")
  })

  it("parses expiresAt as a number, null when absent", () => {
    const storage = makeStorage()
    const s = createStorageTokenStore(storage)
    expect(s.getExpiresAt()).toBeNull()
    s.setExpiresAt(1700000000)
    expect(storage.data.expiresAt).toBe("1700000000")
    expect(s.getExpiresAt()).toBe(1700000000)
  })

  it("clear() removes all four keys", () => {
    const storage = makeStorage()
    const s = createStorageTokenStore(storage)
    s.setAccessToken("a")
    s.setRefreshToken("r")
    s.setExpiresAt(1)
    s.setUserId("u")
    void s.clear()
    expect(storage.data).toEqual({})
  })

  it("honours custom storage keys", () => {
    const storage = makeStorage()
    const s = createStorageTokenStore(storage, {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: "exp",
      userId: "uid",
    })
    s.setAccessToken("a")
    expect(storage.data.at).toBe("a")
    expect(storage.data.accessToken).toBeUndefined()
  })
})
