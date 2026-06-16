import { formatBeltWithStripes } from "./belt"

describe("formatBeltWithStripes", () => {
  it("shows just the belt label when there are no stripes", () => {
    expect(formatBeltWithStripes("blue", 0)).toBe("Синий пояс")
    expect(formatBeltWithStripes("white", -1)).toBe("Белый пояс")
  })

  it("uses the singular form for 1 (but not 11)", () => {
    expect(formatBeltWithStripes("blue", 1)).toBe("Синий пояс · 1 полоска")
    expect(formatBeltWithStripes("blue", 21)).toBe("Синий пояс · 21 полоска")
  })

  it("uses the 2-4 form (but not 12-14)", () => {
    expect(formatBeltWithStripes("blue", 2)).toBe("Синий пояс · 2 полоски")
    expect(formatBeltWithStripes("blue", 3)).toBe("Синий пояс · 3 полоски")
    expect(formatBeltWithStripes("blue", 4)).toBe("Синий пояс · 4 полоски")
  })

  it("uses the many form for 5+, 0-ending, and the 11-14 exception", () => {
    expect(formatBeltWithStripes("blue", 5)).toBe("Синий пояс · 5 полосок")
    expect(formatBeltWithStripes("blue", 11)).toBe("Синий пояс · 11 полосок")
    expect(formatBeltWithStripes("blue", 12)).toBe("Синий пояс · 12 полосок")
    expect(formatBeltWithStripes("blue", 14)).toBe("Синий пояс · 14 полосок")
  })

  it("uses the right belt label per rank", () => {
    expect(formatBeltWithStripes("black", 2)).toBe("Чёрный пояс · 2 полоски")
  })
})
