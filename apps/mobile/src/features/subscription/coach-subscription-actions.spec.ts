import {
  canSellAbonement,
  coachAbonementActions,
  parseWholeNumber,
  pastDebts,
  sellablePlans,
} from "./coach-subscription-actions"

const TODAY = "2026-10-24"

const bjj = { id: "d-bjj", name: "БЖЖ", color: "#f00", icon: null }
const mma = { id: "d-mma", name: "ММА", color: null, icon: null }

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
  directions: [],
  freezeRequest: null,
  renewFrom: "2026-10-31",
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

const perms = (canManage = true) => ({
  canManage,
  canCancel: false,
  canUnmarkPayment: false,
})

const run = (
  abonement: Record<string, unknown> = {},
  over: { freezes?: unknown[]; canManage?: boolean } = {},
) =>
  coachAbonementActions(
    sub(abonement) as never,
    {
      freezes: over.freezes ?? [],
      permissions: perms(over.canManage ?? true),
    } as never,
    TODAY,
  )

describe("coachAbonementActions", () => {
  it("offers no direct freeze while the student's request on it is pending", () => {
    expect(
      run({ freezeRequest: { id: "r1", status: "PENDING" } }).canFreeze,
    ).toBe(false)
    expect(run({ freezeRequest: { id: "r1", status: "DECLINED" } }).canFreeze).toBe(true)
  })

  it("offers nothing without canManage", () => {
    expect(
      run({ isPaid: false }, { canManage: false, freezes: [freeze()] }),
    ).toEqual({
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
      renewFromYmd: "2026-10-31",
      waitsForClasses: false,
      canMarkPaid: false,
      canFreeze: true,
      canEndFreeze: false,
      openFreeze: null,
    })
  })

  it("offers mark-paid only for an unpaid abonement", () => {
    expect(run({ isPaid: false }).canMarkPaid).toBe(true)
    expect(run().canMarkPaid).toBe(false)
  })

  it("cannot freeze one that waits for the first visit or has no end", () => {
    expect(run({ startDate: null }).canFreeze).toBe(false)
    expect(run({ endDate: null }).canFreeze).toBe(false)
  })

  it("renews nothing over a used-up class pack", () => {
    const out = run({ classesTotal: 8, classesRemaining: 0 })
    expect(out.renewFromYmd).toBeNull()
    expect(out.waitsForClasses).toBe(false)
  })

  it("renews with the server's club-local day verbatim, per abonement", () => {
    expect(run({ renewFrom: "2026-11-15" }).renewFromYmd).toBe("2026-11-15")
    expect(run({ startDate: null, endDate: null, renewFrom: null }).renewFromYmd).toBeNull()
  })

  it("shows a hint, not a renewal, over a live class pack with classes left", () => {
    const out = run({ classesTotal: 8, classesRemaining: 3, renewFrom: null })
    expect(out.renewFromYmd).toBeNull()
    expect(out.waitsForClasses).toBe(true)
  })

  it("offers ending instead of starting while a freeze is running or planned", () => {
    const planned = run({}, { freezes: [freeze()] })
    expect(planned.canFreeze).toBe(false)
    expect(planned.canEndFreeze).toBe(true)
    expect(planned.openFreeze).toMatchObject({ id: "f1" })
    const running = run(
      {},
      { freezes: [freeze({ fromDate: "2026-10-20", untilDate: "2026-10-24" })] },
    )
    expect(running.canEndFreeze).toBe(true)
  })

  it("ignores finished freezes and freezes of other abonements", () => {
    const out = run(
      {},
      {
        freezes: [
          freeze({ id: "old", fromDate: "2026-10-01", untilDate: "2026-10-07" }),
          freeze({ id: "other", subscriptionId: "s0" }),
        ],
      },
    )
    expect(out.openFreeze).toBeNull()
    expect(out.canFreeze).toBe(true)
    expect(out.canEndFreeze).toBe(false)
  })

  it("picks the earliest open freeze", () => {
    const out = run(
      {},
      {
        freezes: [
          freeze({ id: "later", fromDate: "2026-10-28", untilDate: "2026-10-30" }),
          freeze({ id: "sooner", fromDate: "2026-10-25", untilDate: "2026-10-26" }),
        ],
      },
    )
    expect(out.openFreeze).toMatchObject({ id: "sooner" })
  })
})

describe("sellablePlans / canSellAbonement", () => {
  const clubWide = { id: "p-all", directions: [] }
  const bjjPlan = { id: "p-bjj", directions: [bjj] }
  const comboPlan = { id: "p-combo", directions: [mma, bjj] }
  const plans = [clubWide, bjjPlan, comboPlan]

  it("drops tariffs whose direction set matches a live abonement", () => {
    const abonements = [sub({ directions: [bjj] })] as never
    expect(sellablePlans(plans, abonements).map((p) => p.id)).toEqual([
      "p-all",
      "p-combo",
    ])
  })

  it("compares sets, not order", () => {
    const abonements = [sub({ directions: [bjj, mma] })] as never
    expect(sellablePlans(plans, abonements).map((p) => p.id)).toEqual([
      "p-all",
      "p-bjj",
    ])
  })

  it("a used-up pack does not block its scope", () => {
    const abonements = [
      sub({ classesTotal: 8, classesRemaining: 0 }),
    ] as never
    expect(sellablePlans(plans, abonements)).toHaveLength(3)
  })

  it("sells over nothing live, even with no tariffs (the form explains)", () => {
    expect(
      canSellAbonement({ abonements: [], permissions: perms() } as never, []),
    ).toBe(true)
  })

  it("offers no sale in a club without directions over a live abonement", () => {
    expect(
      canSellAbonement(
        { abonements: [sub()], permissions: perms() } as never,
        [clubWide],
      ),
    ).toBe(false)
  })

  it("offers another sale when a different scope is left, never without canManage", () => {
    const data = { abonements: [sub()], permissions: perms() } as never
    expect(canSellAbonement(data, [clubWide, bjjPlan])).toBe(true)
    expect(
      canSellAbonement(
        { abonements: [], permissions: perms(false) } as never,
        [bjjPlan],
      ),
    ).toBe(false)
  })
})

describe("pastDebts", () => {
  it("lists unpaid active/expired rows except the current ones", () => {
    const out = pastDebts({
      abonements: [
        sub({ id: "cur", isPaid: false }),
        sub({ id: "cur2", isPaid: false }),
      ] as never,
      history: [
        sub({ id: "cur", isPaid: false }),
        sub({ id: "cur2", isPaid: false }),
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
