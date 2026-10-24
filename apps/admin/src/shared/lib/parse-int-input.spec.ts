import { parseIntInput } from "./parse-int-input"

const range = { min: 1, max: 3650 }

describe("parseIntInput", () => {
  it("parses plain digits", () => {
    expect(parseIntInput("30", range)).toBe(30)
  })

  it("strips regular, non-breaking and narrow spaces", () => {
    expect(parseIntInput("1 500", { min: 0, max: 100000 })).toBe(1500)
    expect(parseIntInput("1 500", { min: 0, max: 100000 })).toBe(1500)
    expect(parseIntInput(" 1 500 ", { min: 0, max: 100000 })).toBe(1500)
  })

  it("rejects empty, decimals, letters and signs", () => {
    expect(parseIntInput("", range)).toBeNull()
    expect(parseIntInput("  ", range)).toBeNull()
    expect(parseIntInput("1,5", range)).toBeNull()
    expect(parseIntInput("1.5", range)).toBeNull()
    expect(parseIntInput("abc", range)).toBeNull()
    expect(parseIntInput("-3", range)).toBeNull()
  })

  it("rejects values outside the range", () => {
    expect(parseIntInput("0", range)).toBeNull()
    expect(parseIntInput("3651", range)).toBeNull()
    expect(parseIntInput("0", { min: 0, max: 10 })).toBe(0)
  })
})
