import { canRoutePush, createPendingPush } from "./push-pending"

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

describe("createPendingPush with a payload check", () => {
  it("asks the check about the held payload", () => {
    const p = createPendingPush()
    p.hold({ kind: "member.invitation" })
    const refuse = jest.fn((_data: unknown) => false)
    expect(p.take(refuse)).toBeNull()
    expect(refuse).toHaveBeenCalledWith({ kind: "member.invitation" })
    expect(p.take(() => true)).toEqual({ data: { kind: "member.invitation" } })
    expect(p.take(() => true)).toBeNull()
  })
})

describe("canRoutePush", () => {
  const club = { accessExpired: false }
  const invitation = { kind: "member.invitation", workspaceId: "other" }

  it("waits for the navigator", () => {
    expect(
      canRoutePush({ kind: "rank.promoted" }, { navReady: false, signedIn: true, workspace: club }),
    ).toBe(false)
    expect(
      canRoutePush(invitation, { navReady: false, signedIn: true, workspace: null }),
    ).toBe(false)
  })

  it("needs an active club for club notifications", () => {
    expect(
      canRoutePush({ kind: "rank.promoted" }, { navReady: true, signedIn: true, workspace: null }),
    ).toBe(false)
    expect(
      canRoutePush({ kind: "rank.promoted" }, { navReady: true, signedIn: true, workspace: club }),
    ).toBe(true)
  })

  it("routes an invitation without any club, once signed in", () => {
    expect(
      canRoutePush(invitation, { navReady: true, signedIn: true, workspace: null }),
    ).toBe(true)
    expect(
      canRoutePush(invitation, { navReady: true, signedIn: false, workspace: null }),
    ).toBe(false)
  })

  it("routes nothing behind the lock screen", () => {
    const lapsed = { accessExpired: true }
    expect(
      canRoutePush(invitation, { navReady: true, signedIn: true, workspace: lapsed }),
    ).toBe(false)
    expect(
      canRoutePush({ kind: "rank.promoted" }, { navReady: true, signedIn: true, workspace: lapsed }),
    ).toBe(false)
  })
})
