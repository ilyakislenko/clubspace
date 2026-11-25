import { ageOn, formatBirthDate } from "./birth-date"

describe("ageOn", () => {
  it("counts full years, the birthday itself included", () => {
    expect(ageOn("2016-05-04", "2026-05-03")).toBe(9)
    expect(ageOn("2016-05-04", "2026-05-04")).toBe(10)
    expect(ageOn("2016-05-04", "2026-11-26")).toBe(10)
  })

  it("is null for anything that isn't a date", () => {
    expect(ageOn("4 мая", "2026-11-26")).toBeNull()
  })
})

describe("formatBirthDate", () => {
  it("spells the date with the age", () => {
    expect(formatBirthDate("2016-05-04", "2026-11-26")).toBe("4 мая 2016 (10 лет)")
    expect(formatBirthDate("2005-11-26", "2026-11-26")).toBe("26 ноября 2005 (21 год)")
    expect(formatBirthDate("2023-01-01", "2026-11-26")).toBe("1 января 2023 (3 года)")
  })

  it("leaves an unexpected value as it is", () => {
    expect(formatBirthDate("05/04/2016", "2026-11-26")).toBe("05/04/2016")
  })
})
