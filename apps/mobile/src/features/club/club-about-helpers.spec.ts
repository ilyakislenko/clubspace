import { paragraphs, telUrl } from "./club-about-helpers"

describe("paragraphs", () => {
  it("splits on blank lines and keeps single newlines inside a paragraph", () => {
    expect(paragraphs("Раз\nдва\n\nТри\r\n\r\n  \n\nЧетыре")).toEqual([
      "Раз\nдва",
      "Три",
      "Четыре",
    ])
  })
  it("returns nothing for empty or null rules", () => {
    expect(paragraphs(null)).toEqual([])
    expect(paragraphs("  \n\n ")).toEqual([])
  })
})

describe("telUrl", () => {
  it("strips formatting", () => {
    expect(telUrl("+7 952 884-94-20")).toBe("tel:+79528849420")
    expect(telUrl("+79528849420")).toBe("tel:+79528849420")
  })
})
