import {
  formatAmount,
  isPending,
  paymentLabel,
  periodLabel,
} from "./subscription-display"

// Sold on the browser's 24 October: the latest start is 7 November.
const createdAt = new Date(2026, 9, 24, 12).toISOString()

describe("periodLabel", () => {
  it("says the term counts from the first visit, no later than the deadline", () => {
    expect(
      periodLabel({
        startDate: null,
        endDate: null,
        durationDays: 30,
        createdAt,
      }),
    ).toBe("с первой тренировки (не позже 07.11.2026) · 30 дн.")
  })

  it("drops the duration for a row from before it was recorded", () => {
    expect(
      periodLabel({
        startDate: null,
        endDate: null,
        durationDays: null,
        createdAt,
      }),
    ).toBe("с первой тренировки (не позже 07.11.2026)")
  })

  it("shows the dd.mm.yyyy range once started", () => {
    expect(
      periodLabel({
        startDate: "2026-10-24T12:00:00.000Z",
        endDate: "2026-11-23T12:00:00.000Z",
        durationDays: 30,
        createdAt,
      }),
    ).toBe("24.10.2026 → 23.11.2026")
  })

  it("shows an open-ended pack as a dash on the right", () => {
    expect(
      periodLabel({
        startDate: "2026-10-24T12:00:00.000Z",
        endDate: null,
        durationDays: null,
        createdAt,
      }),
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
  it("groups thousands and appends the currency code", () => {
    expect(plain(formatAmount(5000, "RUB"))).toBe("5 000 RUB")
    expect(formatAmount(0, "RUB")).toBe("0 RUB")
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
    ).toBe("Ожидает оплаты: 5 000 RUB")
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
    ).toBe("Оплачено 5 000 RUB · 22.10.2026")
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
    ).toBe("Оплачено 4 000 RUB")
  })
})
