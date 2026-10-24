import { isPending, periodLabel } from "./subscription-display"

describe("periodLabel", () => {
  it("says the term counts from the first visit while it has no dates", () => {
    expect(
      periodLabel({ startDate: null, endDate: null, durationDays: 30 }),
    ).toBe("с первой тренировки · 30 дн.")
  })

  it("drops the duration for a row from before it was recorded", () => {
    expect(
      periodLabel({ startDate: null, endDate: null, durationDays: null }),
    ).toBe("с первой тренировки")
  })

  it("shows the dd.mm.yyyy range once started", () => {
    expect(
      periodLabel({
        startDate: "2026-10-24T12:00:00.000Z",
        endDate: "2026-11-23T12:00:00.000Z",
        durationDays: 30,
      }),
    ).toBe("24.10.2026 → 23.11.2026")
  })

  it("shows an open-ended pack as a dash on the right", () => {
    expect(
      periodLabel({
        startDate: "2026-10-24T12:00:00.000Z",
        endDate: null,
        durationDays: null,
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
