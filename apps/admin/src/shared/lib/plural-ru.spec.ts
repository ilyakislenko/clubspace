import { pluralRu } from "./plural-ru"

describe("pluralRu", () => {
  it.each([
    [1, "кандидат"],
    [2, "кандидата"],
    [5, "кандидатов"],
    [11, "кандидатов"],
    [21, "кандидат"],
    [0, "кандидатов"],
  ])("%i", (n, word) => {
    expect(pluralRu(n, "кандидат", "кандидата", "кандидатов")).toBe(word)
  })
})
