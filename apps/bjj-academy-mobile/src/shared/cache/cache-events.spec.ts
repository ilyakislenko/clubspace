import { invalidateResource, subscribeInvalidation } from "./cache-events"

describe("cache-events", () => {
  it("invalidates the exact resource:workspace key", () => {
    const cb = jest.fn()
    const off = subscribeInvalidation("announcements:w1", cb)
    invalidateResource("announcements", "w1")
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it("ignores a different workspace or resource", () => {
    const cb = jest.fn()
    const off = subscribeInvalidation("announcements:w1", cb)
    invalidateResource("announcements", "w2")
    invalidateResource("ranks", "w1")
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it("matches deeper keys under the base", () => {
    const cb = jest.fn()
    const off = subscribeInvalidation("leaderboard:w1:month", cb)
    invalidateResource("leaderboard", "w1")
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it("stops delivering after unsubscribe", () => {
    const cb = jest.fn()
    const off = subscribeInvalidation("ranks:w1", cb)
    off()
    invalidateResource("ranks", "w1")
    expect(cb).not.toHaveBeenCalled()
  })
})
