import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  classesLabel,
  renewFromForPlan,
  formatAmount,
  isPending,
  paymentLabel,
  periodLabel,
} from "./subscription-display"

// Sold on the browser's 24 October: the latest start is 7 November.
const createdAt = new Date(2026, 9, 24, 12).toISOString()
const GRAPPLING = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")

describe("periodLabel", () => {
  it("says the term counts from the first visit, no later than the deadline", () => {
    expect(
      periodLabel(
        { startDate: null, endDate: null, durationDays: 30, createdAt },
        GRAPPLING,
      ),
    ).toBe("с первой тренировки (не позже 07.11.2026) · 30 дн.")
  })

  it("names the first class in the club's words", () => {
    expect(
      periodLabel(
        { startDate: null, endDate: null, durationDays: 30, createdAt },
        DANCE,
      ),
    ).toBe("с первого занятия (не позже 07.11.2026) · 30 дн.")
  })

  it("drops the duration for a row from before it was recorded", () => {
    expect(
      periodLabel({
        startDate: null,
        endDate: null,
        durationDays: null,
        createdAt,
      }, GRAPPLING),
    ).toBe("с первой тренировки (не позже 07.11.2026)")
  })

  it("shows the dd.mm.yyyy range once started", () => {
    expect(
      periodLabel({
        startDate: "2026-10-24T12:00:00.000Z",
        endDate: "2026-11-23T12:00:00.000Z",
        durationDays: 30,
        createdAt,
      }, GRAPPLING),
    ).toBe("24.10.2026 → 23.11.2026")
  })

  it("shows an open-ended pack as a dash on the right", () => {
    expect(
      periodLabel({
        startDate: "2026-10-24T12:00:00.000Z",
        endDate: null,
        durationDays: null,
        createdAt,
      }, GRAPPLING),
    ).toBe("24.10.2026 → —")
  })
})

describe("isPending", () => {
  it("is true only for a null startDate", () => {
    expect(isPending({ startDate: null })).toBe(true)
    expect(isPending({ startDate: "2026-10-24T00:00:00.000Z" })).toBe(false)
  })
})

// Intl groups thousands with a no-break space.
const plain = (text: string) => text.replace(/\u00a0|\u202f/g, " ")

describe("formatAmount", () => {
  it("groups thousands and renders roubles as ₽", () => {
    expect(plain(formatAmount(5000, "RUB"))).toBe("5 000 ₽")
    expect(formatAmount(0, "RUB")).toBe("0 ₽")
  })

  it("keeps the code of any other currency", () => {
    expect(plain(formatAmount(50, "USD"))).toBe("50 USD")
  })
})

describe("paymentLabel", () => {
  it("flags an unpaid abonement with its agreed price", () => {
    expect(
      plain(
        paymentLabel({
          isPaid: false,
          paidAt: null,
          amountPaid: 5000,
          currency: "RUB",
        }),
      ),
    ).toBe("Ожидает оплаты: 5 000 ₽")
  })

  it("shows the amount and the payment date once paid", () => {
    expect(
      plain(
        paymentLabel({
          isPaid: true,
          paidAt: new Date(2026, 9, 22, 12).toISOString(),
          amountPaid: 5000,
          currency: "RUB",
        }),
      ),
    ).toBe("Оплачено 5 000 ₽ · 22.10.2026")
  })

  it("drops the date on a row from before payment tracking", () => {
    expect(
      plain(
        paymentLabel({
          isPaid: true,
          paidAt: null,
          amountPaid: 4000,
          currency: "RUB",
        }),
      ),
    ).toBe("Оплачено 4 000 ₽")
  })
})

describe("classesLabel", () => {
  it("shows remaining / total for a class pack", () => {
    expect(classesLabel({ classesTotal: 12, classesRemaining: 3 })).toBe(
      "Занятий: 3 / 12",
    )
    expect(classesLabel({ classesTotal: 12, classesRemaining: null })).toBe(
      "Занятий: 0 / 12",
    )
  })

  it("is null for a time-based abonement", () => {
    expect(classesLabel({ classesTotal: null, classesRemaining: null })).toBeNull()
  })
})

describe("renewFromForPlan", () => {
  const club = { directions: [], renewFrom: "2026-12-01" }
  const bjj = { directions: [{ id: "bjj" }], renewFrom: "2026-11-20" }

  it("takes the renewFrom of the abonement with the same scope", () => {
    expect(renewFromForPlan({ directions: [] }, [bjj, club])).toBe("2026-12-01")
    expect(renewFromForPlan({ directions: [{ id: "bjj" }] }, [club, bjj])).toBe(
      "2026-11-20",
    )
  })

  it("compares scopes as sets", () => {
    const both = {
      directions: [{ id: "a" }, { id: "b" }],
      renewFrom: "2026-11-15",
    }
    expect(
      renewFromForPlan({ directions: [{ id: "b" }, { id: "a" }] }, [both]),
    ).toBe("2026-11-15")
    expect(renewFromForPlan({ directions: [{ id: "a" }] }, [both])).toBeNull()
  })

  it("is null without a same-scope abonement", () => {
    expect(renewFromForPlan({ directions: [] }, [bjj])).toBeNull()
    expect(renewFromForPlan({ directions: [] }, [])).toBeNull()
  })
})
