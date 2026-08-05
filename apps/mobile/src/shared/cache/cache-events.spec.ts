import {
  applyListDelta,
  applyListOp,
  invalidateResource,
  subscribeInvalidation,
  subscribeListDelta,
} from "./cache-events"

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

describe("applyListOp", () => {
  const list = [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ]

  it("create prepends and dedupes by id", () => {
    expect(applyListOp(list, "create", { id: "c", n: 3 })).toEqual([
      { id: "c", n: 3 },
      { id: "a", n: 1 },
      { id: "b", n: 2 },
    ])
    // A create for an existing id replaces + moves to front.
    expect(applyListOp(list, "create", { id: "b", n: 9 })).toEqual([
      { id: "b", n: 9 },
      { id: "a", n: 1 },
    ])
  })

  it("update replaces by id, delete removes by id", () => {
    expect(applyListOp(list, "update", { id: "a", n: 7 })).toEqual([
      { id: "a", n: 7 },
      { id: "b", n: 2 },
    ])
    expect(applyListOp(list, "delete", { id: "a" })).toEqual([{ id: "b", n: 2 }])
  })
})

describe("list delta bus", () => {
  it("delivers a delta only to the matching key's subscriber", () => {
    const cb = jest.fn()
    const other = jest.fn()
    const off = subscribeListDelta("announcements:w1", cb)
    const off2 = subscribeListDelta("announcements:w2", other)
    applyListDelta("announcements:w1", "create", { id: "x" })
    expect(cb).toHaveBeenCalledWith("create", { id: "x" })
    expect(other).not.toHaveBeenCalled()
    off()
    off2()
  })
})
