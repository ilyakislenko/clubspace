import {
  coachSubscriptionActions,
  parseWholeNumber,
  pastDebts,
} from "./coach-subscription-actions"

const TODAY = "2026-10-24"

const sub = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  planId: "p1",
  planName: "Месяц",
  status: "ACTIVE",
  startDate: "2026-10-01T00:00:00.000Z",
  endDate: "2026-10-30T17:00:00.000Z",
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
    renewFrom?: string | null
    canManage?: boolean
    canCancel?: boolean
    freezeRequest?: unknown
  } = {},
) =>
  coachSubscriptionActions(
    {
      current: "current" in over ? over.current : sub(),
      freezes: over.freezes ?? [],
      freezeRequest: over.freezeRequest ?? null,
      renewFrom: "renewFrom" in over ? over.renewFrom : "2026-10-31",
      permissions: {
        canManage: over.canManage ?? true,
        canCancel: over.canCancel ?? false,
        canUnmarkPayment: false,
      },
    } as never,
    TODAY,
  )

describe("coachSubscriptionActions", () => {
  it("offers no direct freeze while the student's request is pending", () => {
    expect(
      run({ freezeRequest: { id: "r1", status: "PENDING" } }).canFreeze,
    ).toBe(false)
    expect(run({ freezeRequest: null }).canFreeze).toBe(true)
  })

  it("offers nothing without canManage", () => {
    expect(
      run({
        canManage: false,
        current: sub({ isPaid: false }),
        freezes: [freeze()],
      }),
    ).toEqual({
      canAssign: false,
      renewFromYmd: null,
      waitsForClasses: false,
      canMarkPaid: false,
      canFreeze: false,
      canEndFreeze: false,
      openFreeze: expect.objectContaining({ id: "f1" }),
    })
  })

  it("lets a manager renew and freeze a paid, started abonement", () => {
    expect(run()).toEqual({
      canAssign: false,
      renewFromYmd: "2026-10-31",
      waitsForClasses: false,
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

  it("cannot freeze without a current abonement, and sells instead of renewing", () => {
    const out = run({ current: null })
    expect(out.canFreeze).toBe(false)
    expect(out.canAssign).toBe(true)
    expect(out.renewFromYmd).toBeNull()
  })

  it("sells again over a used-up class pack, renewing nothing", () => {
    const out = run({
      current: sub({ classesTotal: 8, classesRemaining: 0 }),
    })
    expect(out.canAssign).toBe(true)
    expect(out.renewFromYmd).toBeNull()
  })

  it("offers neither sale nor renewal over a live abonement without an end", () => {
    const out = run({
      current: sub({ startDate: null, endDate: null }),
      renewFrom: null,
    })
    expect(out.canAssign).toBe(false)
    expect(out.renewFromYmd).toBeNull()
    expect(out.waitsForClasses).toBe(false)
  })

  it("renews with the server's club-local day verbatim, whatever the device zone", () => {
    // The end instant is club midnight in Tomsk (17:00Z the day before); the
    // device calendar could read either day, so only `renewFrom` is trusted.
    const out = run({
      current: sub({ endDate: "2026-10-30T17:00:00.000Z" }),
      renewFrom: "2026-10-31",
    })
    expect(out.renewFromYmd).toBe("2026-10-31")
  })

  it("shows a hint, not a sale or renewal, over a live class pack with classes left", () => {
    const out = run({
      current: sub({ classesTotal: 8, classesRemaining: 3 }),
      renewFrom: null,
    })
    expect(out.canAssign).toBe(false)
    expect(out.renewFromYmd).toBeNull()
    expect(out.waitsForClasses).toBe(true)
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

describe("pastDebts", () => {
  it("lists unpaid active/expired rows except the current one", () => {
    const out = pastDebts({
      current: sub({ id: "cur", isPaid: false }) as never,
      history: [
        sub({ id: "cur", isPaid: false }),
        sub({ id: "old", status: "EXPIRED", isPaid: false }),
        sub({ id: "paid", status: "EXPIRED", isPaid: true }),
        sub({ id: "gone", status: "CANCELLED", isPaid: false }),
      ] as never,
    })
    expect(out.map((s) => s.id)).toEqual(["old"])
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
