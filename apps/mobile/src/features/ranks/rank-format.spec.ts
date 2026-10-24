import { formatLevelWithStripes, stripeColorOn } from "./rank-format"

describe("formatLevelWithStripes", () => {
  it("shows just the level name when there are no stripes", () => {
    expect(formatLevelWithStripes("Синий", 0)).toBe("Синий")
    expect(formatLevelWithStripes("Белый", -1)).toBe("Белый")
  })

  it("uses the singular form for 1, 21, …", () => {
    expect(formatLevelWithStripes("Синий", 1)).toBe("Синий · 1 полоска")
    expect(formatLevelWithStripes("Синий", 21)).toBe("Синий · 21 полоска")
  })

  it("uses the paucal form for 2–4", () => {
    expect(formatLevelWithStripes("Синий", 2)).toBe("Синий · 2 полоски")
    expect(formatLevelWithStripes("Синий", 3)).toBe("Синий · 3 полоски")
    expect(formatLevelWithStripes("Синий", 4)).toBe("Синий · 4 полоски")
  })

  it("uses the plural form for 5+ and the 11–14 exception", () => {
    expect(formatLevelWithStripes("Синий", 5)).toBe("Синий · 5 полосок")
    expect(formatLevelWithStripes("Синий", 11)).toBe("Синий · 11 полосок")
    expect(formatLevelWithStripes("Синий", 12)).toBe("Синий · 12 полосок")
    expect(formatLevelWithStripes("Синий", 14)).toBe("Синий · 14 полосок")
  })
})

describe("stripeColorOn", () => {
  it("draws dark stripes on a light level and light stripes on a dark one", () => {
    expect(stripeColorOn("#f1f5f9")).toBe("#0f172a")
    expect(stripeColorOn("#0f172a")).toBe("#ffffff")
    expect(stripeColorOn("#1d4ed8")).toBe("#ffffff")
  })

  it("falls back to light stripes when the colour is missing or not hex", () => {
    expect(stripeColorOn(null)).toBe("#ffffff")
    expect(stripeColorOn("red")).toBe("#ffffff")
  })
})
