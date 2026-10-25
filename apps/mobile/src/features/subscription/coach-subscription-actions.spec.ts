import {
  coachSubscriptionActions,
  parseWholeNumber,
} from "./coach-subscription-actions"

const TODAY = "2026-10-24"

const sub = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  planId: "p1",
  planName: "Месяц",
  status: "ACTIVE",
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-31T00:00:00.000Z",
  durationDays: 30,
  startsOnFirstVisit: false,
  amountPaid: 5000,
  currency: "RUB",
  isPaid: true,
  paidAt: "2026-10-01T00:00:00.000Z",
  classesTotal: null,
  classesRemaining: null,
  source: "MANUAL",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
})

const freeze = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  subscriptionId: "s1",
  fromDate: "2026-10-25",
  untilDate: "2026-10-31",
  days: 7,
  reason: null,
  endedEarlyAt: null,
  createdAt: "2026-10-24T09:00:00.000Z",
  ...over,
})

const run = (
  over: {
    current?: unknown
    freezes?: unknown[]
    canManage?: boolean
    canCancel?: boolean
  } = {},
) =>
  coachSubscriptionActions(
    {
      current: "current" in over ? over.current : sub(),
      freezes: over.freezes ?? [],
      permissions: {
        canManage: over.canManage ?? true,
        canCancel: over.canCancel ?? false,
      },
    } as never,
    TODAY,
  )

describe("coachSubscriptionActions", () => {
  it("offers nothing without canManage", () => {
    expect(
      run({
        canManage: false,
        current: sub({ isPaid: false }),
        freezes: [freeze()],
      }),
    ).toEqual({
      canAssign: false,
      canMarkPaid: false,
      canFreeze: false,
      canEndFreeze: false,
      openFreeze: expect.objectContaining({ id: "f1" }),
    })
  })

  it("lets a manager assign and freeze a paid, started abonement", () => {
    expect(run()).toEqual({
      canAssign: true,
      canMarkPaid: false,
      canFreeze: true,
      canEndFreeze: false,
      openFreeze: null,
    })
  })

  it("offers mark-paid only for an unpaid current abonement", () => {
    expect(run({ current: sub({ isPaid: false }) }).canMarkPaid).toBe(true)
    expect(run({ current: null }).canMarkPaid).toBe(false)
  })

  it("cannot freeze without a current abonement", () => {
    expect(run({ current: null }).canFreeze).toBe(false)
    expect(run({ current: null }).canAssign).toBe(true)
  })

  it("cannot freeze one that waits for the first visit or has no end", () => {
    expect(run({ current: sub({ startDate: null, endDate: null }) }).canFreeze).toBe(false)
    expect(run({ current: sub({ endDate: null }) }).canFreeze).toBe(false)
  })

  it("offers ending instead of starting while a freeze is running or planned", () => {
    const planned = run({ freezes: [freeze()] })
    expect(planned.canFreeze).toBe(false)
    expect(planned.canEndFreeze).toBe(true)
    expect(planned.openFreeze).toMatchObject({ id: "f1" })
    const running = run({
      freezes: [freeze({ fromDate: "2026-10-20", untilDate: "2026-10-24" })],
    })
    expect(running.canEndFreeze).toBe(true)
  })

  it("ignores finished freezes and freezes of other abonements", () => {
    const out = run({
      freezes: [
        freeze({ id: "old", fromDate: "2026-10-01", untilDate: "2026-10-07" }),
        freeze({ id: "other", subscriptionId: "s0" }),
      ],
    })
    expect(out.openFreeze).toBeNull()
    expect(out.canFreeze).toBe(true)
    expect(out.canEndFreeze).toBe(false)
  })

  it("picks the earliest open freeze", () => {
    const out = run({
      freezes: [
        freeze({ id: "later", fromDate: "2026-10-28", untilDate: "2026-10-30" }),
        freeze({ id: "sooner", fromDate: "2026-10-25", untilDate: "2026-10-26" }),
      ],
    })
    expect(out.openFreeze).toMatchObject({ id: "sooner" })
  })
})

describe("parseWholeNumber", () => {
  const range = { min: 0, max: 10_000_000 }

  it("parses digits, ignoring spaces and no-break spaces", () => {
    expect(parseWholeNumber("5000", range)).toBe(5000)
    expect(parseWholeNumber("5 000", range)).toBe(5000)
    expect(parseWholeNumber("5\u00A0000", range)).toBe(5000)
    expect(parseWholeNumber("0", range)).toBe(0)
  })

  it("rejects empty, decimals, signs and letters", () => {
    for (const raw of ["", " ", "5.5", "5,5", "-1", "+1", "12a"]) {
      expect(parseWholeNumber(raw, range)).toBeNull()
    }
  })

  it("rejects values outside the range", () => {
    expect(parseWholeNumber("10000001", range)).toBeNull()
    expect(parseWholeNumber("0", { min: 1, max: 90 })).toBeNull()
    expect(parseWholeNumber("91", { min: 1, max: 90 })).toBeNull()
    expect(parseWholeNumber("90", { min: 1, max: 90 })).toBe(90)
  })
})
