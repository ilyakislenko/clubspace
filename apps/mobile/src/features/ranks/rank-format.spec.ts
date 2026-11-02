import {
  formatLevelWithStripes,
  stripeColorOn,
  swatchBlendsIn,
} from "./rank-format"

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

  it("reads the short hex and named colours coaches actually type", () => {
    expect(stripeColorOn("#fff")).toBe("#0f172a")
    expect(stripeColorOn("White")).toBe("#0f172a")
    expect(stripeColorOn(" yellow ")).toBe("#0f172a")
    expect(stripeColorOn("black")).toBe("#ffffff")
    expect(stripeColorOn("#00f")).toBe("#ffffff")
  })

  it("falls back to light stripes when the colour is missing or unparseable", () => {
    expect(stripeColorOn(null)).toBe("#ffffff")
    expect(stripeColorOn("белый")).toBe("#ffffff")
    expect(stripeColorOn("#12345")).toBe("#ffffff")
  })
})

describe("swatchBlendsIn", () => {
  it("flags a white belt on a light theme only", () => {
    expect(swatchBlendsIn("#ffffff", "light")).toBe(true)
    expect(swatchBlendsIn("white", "light")).toBe(true)
    expect(swatchBlendsIn("#f5f5f5", "light")).toBe(true)
    expect(swatchBlendsIn("#ffffff", "dark")).toBe(false)
  })

  it("flags a black belt on a dark theme only", () => {
    expect(swatchBlendsIn("#000000", "dark")).toBe(true)
    expect(swatchBlendsIn("#111", "dark")).toBe(true)
    expect(swatchBlendsIn("#000000", "light")).toBe(false)
  })

  it("leaves coloured belts and unreadable colours alone", () => {
    expect(swatchBlendsIn("#1d4ed8", "light")).toBe(false)
    expect(swatchBlendsIn("#1d4ed8", "dark")).toBe(false)
    expect(swatchBlendsIn(null, "light")).toBe(false)
    expect(swatchBlendsIn("белый", "light")).toBe(false)
  })
})
