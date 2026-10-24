import { createPendingPush } from "./push-pending"

describe("createPendingPush", () => {
  it("hands nothing out when empty", () => {
    expect(createPendingPush().take(true)).toBeNull()
  })

  it("keeps the payload until routing is possible", () => {
    const p = createPendingPush()
    p.hold({ kind: "rank.promoted" })
    expect(p.take(false)).toBeNull()
    expect(p.take(false)).toBeNull()
    expect(p.take(true)).toEqual({ data: { kind: "rank.promoted" } })
  })

  it("hands a payload out only once", () => {
    const p = createPendingPush()
    p.hold({ a: 1 })
    expect(p.take(true)).not.toBeNull()
    expect(p.take(true)).toBeNull()
  })

  it("lets a newer tap replace an older unrouted one", () => {
    const p = createPendingPush()
    p.hold({ a: 1 })
    p.hold({ a: 2 })
    expect(p.take(true)).toEqual({ data: { a: 2 } })
  })

  it("still delivers a tap whose data is empty", () => {
    const p = createPendingPush()
    p.hold(undefined)
    expect(p.take(true)).toEqual({ data: undefined })
  })
})
