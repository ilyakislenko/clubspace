import { openDecisions, revenueChangePct, type DecisionCounts } from "./decisions"

const none: DecisionCounts = {
  call: null,
  renew: null,
  awaiting: null,
  join: null,
  freeze: null,
  video: null,
}

describe("«Нужно решение»", () => {
  it("shows a row only while its count is above zero, in a fixed order", () => {
    expect(
      openDecisions({ ...none, video: 2, call: 14, renew: 0, join: 1 }),
    ).toEqual([
      { key: "call", count: 14 },
      { key: "join", count: 1 },
      { key: "video", count: 2 },
    ])
  })

  it("has no rows for a role without those lists or when nothing waits", () => {
    expect(openDecisions(none)).toEqual([])
    expect(openDecisions({ ...none, call: 0, freeze: 0 })).toEqual([])
  })
})

describe("revenue change against the previous 30 days", () => {
  it("is a whole percent, negative for a drop", () => {
    expect(revenueChangePct(1_100, 1_000)).toBe(10)
    expect(revenueChangePct(815_800, 900_000)).toBe(-9)
  })

  it("is absent with nothing to compare with", () => {
    expect(revenueChangePct(5_000, 0)).toBeNull()
  })
})
