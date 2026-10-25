import { paragraphs } from "./club-about-helpers"

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
