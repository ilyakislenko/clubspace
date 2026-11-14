/** @jest-environment jsdom */
import { clearAuthTokens } from "./client"
import { cachedRead, invalidateReads, peekCachedRead } from "./read-cache"

beforeEach(() => {
  clearAuthTokens()
  jest.useRealTimers()
})

describe("cachedRead", () => {
  it("sends one request for callers that ask while it is in flight", async () => {
    const answer = Promise.withResolvers<string>()
    const load = jest.fn(() => answer.promise)
    const first = cachedRead("k", load)
    const second = cachedRead("k", load)
    answer.resolve("v")
    await expect(Promise.all([first, second])).resolves.toEqual(["v", "v"])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("asks again after the answer when nothing is kept (ttl 0)", async () => {
    const load = jest.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new")
    await expect(cachedRead("k", load)).resolves.toBe("old")
    await expect(cachedRead("k", load)).resolves.toBe("new")
    expect(peekCachedRead("k")).toBeUndefined()
  })

  it("keeps the answer for ttl, then asks again", async () => {
    jest.useFakeTimers({ now: 0 })
    const load = jest.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new")
    await cachedRead("k", load, 1000)
    jest.setSystemTime(999)
    await expect(cachedRead("k", load, 1000)).resolves.toBe("old")
    expect(peekCachedRead("k")).toBe("old")
    jest.setSystemTime(1000)
    expect(peekCachedRead("k")).toBeUndefined()
    await expect(cachedRead("k", load, 1000)).resolves.toBe("new")
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("never keeps a failure", async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("v")
    await expect(cachedRead("k", load, 60_000)).rejects.toThrow("down")
    await expect(cachedRead("k", load, 60_000)).resolves.toBe("v")
  })

  it("a write's invalidation drops the kept answer and keys under it, not siblings", async () => {
    await cachedRead("settings:a", async () => 1, 60_000)
    await cachedRead("settings:b", async () => 2, 60_000)
    await cachedRead("settingsX", async () => 3, 60_000)
    invalidateReads("settings:a")
    expect(peekCachedRead("settings:a")).toBeUndefined()
    expect(peekCachedRead("settings:b")).toBe(2)
    invalidateReads("settings")
    expect(peekCachedRead("settings:b")).toBeUndefined()
    expect(peekCachedRead("settingsX")).toBe(3)
  })

  it("a read after a write does not join a request sent before it", async () => {
    const stale = Promise.withResolvers<string>()
    const load = jest.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce("fresh")
    const before = cachedRead("k", load, 60_000)
    invalidateReads("k")
    await expect(cachedRead("k", load, 60_000)).resolves.toBe("fresh")
    stale.resolve("stale")
    await expect(before).resolves.toBe("stale")
    // The overtaken answer did not replace the fresh one.
    expect(peekCachedRead("k")).toBe("fresh")
  })

  it("does not keep the previous account's answer that lands after sign-out", async () => {
    const answer = Promise.withResolvers<string>()
    const pending = cachedRead("me", () => answer.promise, 60_000)
    clearAuthTokens()
    answer.resolve("previous account")
    await pending
    expect(peekCachedRead("me")).toBeUndefined()
  })
})
