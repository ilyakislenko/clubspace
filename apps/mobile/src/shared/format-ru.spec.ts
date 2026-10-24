import { formatMoney, pluralRu } from "./format-ru"

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
    expect(formatMoney(5000, "RUB")).toBe("5 000 ₽")
    expect(formatMoney(500, "RUB")).toBe("500 ₽")
  })
  it("keeps the code for other currencies and shows kopecks", () => {
    expect(formatMoney(1234.5, "USD")).toBe("1 234,50 USD")
  })
})
