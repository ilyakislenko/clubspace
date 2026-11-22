import { abonementState, isLiveState } from "./abonement-state"

// Browser-local 14 November 2026, 15:00.
const NOW = new Date(2026, 10, 14, 15)
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

const sub = (over: Partial<Parameters<typeof abonementState>[0]> = {}) => ({
  id: "s1",
  status: "ACTIVE",
  startDate: at(1),
  endDate: at(30),
  ...over,
})

describe("abonementState", () => {
  it("is active between its start and end", () => {
    expect(abonementState(sub(), [], NOW)).toBe("active")
  })

  it("is expired once its end has passed, though the row still says ACTIVE", () => {
    expect(abonementState(sub({ endDate: at(10) }), [], NOW)).toBe("expired")
  })

  it("still counts on its last day until the end time", () => {
    expect(abonementState(sub({ endDate: at(14, 20) }), [], NOW)).toBe("active")
    expect(abonementState(sub({ endDate: at(14, 9) }), [], NOW)).toBe("expired")
  })

  it("is expired when the server marked it so", () => {
    expect(abonementState(sub({ status: "EXPIRED" }), [], NOW)).toBe("expired")
  })

  it("is cancelled whatever its dates", () => {
    expect(abonementState(sub({ status: "CANCELLED" }), [], NOW)).toBe(
      "cancelled",
    )
    expect(
      abonementState(sub({ status: "CANCELLED", endDate: at(10) }), [], NOW),
    ).toBe("cancelled")
  })

  it("is upcoming when sold to start tomorrow", () => {
    expect(
      abonementState(sub({ startDate: at(15, 0), endDate: at(30) }), [], NOW),
    ).toBe("upcoming")
  })

  it("counts from the start instant, like the server", () => {
    expect(abonementState(sub({ startDate: at(14, 20) }), [], NOW)).toBe(
      "upcoming",
    )
    expect(abonementState(sub({ startDate: at(14, 9) }), [], NOW)).toBe(
      "active",
    )
  })

  it("is upcoming while it waits for the first visit", () => {
    expect(
      abonementState(sub({ startDate: null, endDate: null }), [], NOW),
    ).toBe("upcoming")
  })

  it("is an open-ended class pack: active, never expired", () => {
    expect(abonementState(sub({ endDate: null }), [], NOW)).toBe("active")
  })

  it("is frozen while a freeze covers today", () => {
    const freeze = {
      subscriptionId: "s1",
      fromDate: "2026-11-10",
      untilDate: "2026-11-14",
    }
    expect(abonementState(sub(), [freeze], NOW)).toBe("frozen")
  })

  it("ignores an upcoming or finished freeze and other abonements' freezes", () => {
    const freezes = [
      { subscriptionId: "s1", fromDate: "2026-11-15", untilDate: "2026-11-20" },
      { subscriptionId: "s1", fromDate: "2026-11-01", untilDate: "2026-11-13" },
      { subscriptionId: "s2", fromDate: "2026-11-10", untilDate: "2026-11-20" },
    ]
    expect(abonementState(sub(), freezes, NOW)).toBe("active")
  })

  it("is expired, not frozen, once the end has passed", () => {
    const freeze = {
      subscriptionId: "s1",
      fromDate: "2026-11-10",
      untilDate: "2026-11-20",
    }
    expect(abonementState(sub({ endDate: at(12) }), [freeze], NOW)).toBe(
      "expired",
    )
  })
})

describe("isLiveState", () => {
  it("only active, upcoming and frozen abonements take lifecycle actions", () => {
    expect(isLiveState("active")).toBe(true)
    expect(isLiveState("upcoming")).toBe(true)
    expect(isLiveState("frozen")).toBe(true)
    expect(isLiveState("expired")).toBe(false)
    expect(isLiveState("cancelled")).toBe(false)
  })
})
