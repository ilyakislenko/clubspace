import {
  MONTHS_IN_RU,
  MONTHS_OF_RU,
  MONTHS_RU,
  formatMoney,
  formatPhone,
  formatRuDay,
  formatRuDayRange,
  pluralRu,
} from "./format-ru"

describe("pluralRu", () => {
  const f = (n: number) => pluralRu(n, "занятие", "занятия", "занятий")
  it("picks the right form", () => {
    expect(f(0)).toBe("занятий")
    expect(f(1)).toBe("занятие")
    expect(f(2)).toBe("занятия")
    expect(f(5)).toBe("занятий")
    expect(f(11)).toBe("занятий")
    expect(f(21)).toBe("занятие")
    expect(f(112)).toBe("занятий")
  })
})

describe("formatMoney", () => {
  it("groups thousands and uses ₽ for RUB", () => {
    expect(formatMoney(5000, "RUB")).toBe("5\u202F000\u00A0₽")
    expect(formatMoney(500, "RUB")).toBe("500\u00A0₽")
  })
  it("keeps the code for other currencies and shows kopecks", () => {
    expect(formatMoney(1234.5, "USD")).toBe("1\u202F234,50\u00A0USD")
  })
})

describe("month names", () => {
  it("has twelve nominative names, January first", () => {
    expect(MONTHS_RU).toHaveLength(12)
    expect(MONTHS_RU[0]).toBe("январь")
    expect(MONTHS_RU[11]).toBe("декабрь")
  })

  it("has twelve prepositional names for «в октябре»", () => {
    expect(MONTHS_IN_RU).toHaveLength(12)
    expect(MONTHS_IN_RU[9]).toBe("октябре")
  })

  it("has twelve genitive names for «5 октября»", () => {
    expect(MONTHS_OF_RU).toHaveLength(12)
    expect(MONTHS_OF_RU[2]).toBe("марта")
    expect(MONTHS_OF_RU[9]).toBe("октября")
  })
})

describe("formatRuDay", () => {
  it("renders a plain date in the genitive", () => {
    expect(formatRuDay("2026-10-30")).toBe("30 октября")
    expect(formatRuDay("2026-11-01")).toBe("1 ноября")
  })
})

describe("formatRuDayRange", () => {
  it("collapses a same-month range", () => {
    expect(formatRuDayRange("2026-10-24", "2026-10-30")).toBe(
      "с 24 по 30 октября",
    )
  })
  it("spells both months across a boundary", () => {
    expect(formatRuDayRange("2026-10-28", "2026-11-03")).toBe(
      "с 28 октября по 3 ноября",
    )
  })
})

describe("formatPhone", () => {
  it("groups a Russian number", () => {
    expect(formatPhone("+79528849420")).toBe("+7 952 884-94-20")
  })
  it("leaves any other shape as stored", () => {
    expect(formatPhone("+375291234567")).toBe("+375291234567")
    expect(formatPhone("abc")).toBe("abc")
  })
})
