import { openDecisions, revenueChangePct, type DecisionCounts } from "./decisions"

const none: DecisionCounts = {
  call: null,
  renew: null,
  awaiting: null,
  requests: null,
  leads: null,
  video: null,
}

describe("«Нужно решение»", () => {
  it("shows a row only while its count is above zero, in a fixed order", () => {
    expect(
      openDecisions({ ...none, video: 2, call: 14, renew: 0, requests: 3 }),
    ).toEqual([
      { key: "call", count: 14 },
      { key: "requests", count: 3 },
      { key: "video", count: 2 },
    ])
  })

  it("has one «Заявки» row in place of the join and freeze rows, after «Ожидают оплаты»", () => {
    expect(
      openDecisions({ ...none, awaiting: 1, requests: 4 }).map((r) => r.key),
    ).toEqual(["awaiting", "requests"])
  })

  it("puts «Заявки на пробное» right after «Заявки», only while something needs action", () => {
    expect(
      openDecisions({ ...none, video: 1, leads: 3, requests: 2 }).map((r) => r.key),
    ).toEqual(["requests", "leads", "video"])
    // A coach (null: not fetched) and a sport lead with nothing waiting.
    expect(openDecisions({ ...none, leads: null }).map((r) => r.key)).toEqual([])
    expect(openDecisions({ ...none, leads: 0 }).map((r) => r.key)).toEqual([])
  })

  it("has no rows for a role without those lists or when nothing waits", () => {
    expect(openDecisions(none)).toEqual([])
    expect(openDecisions({ ...none, call: 0, requests: 0 })).toEqual([])
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
