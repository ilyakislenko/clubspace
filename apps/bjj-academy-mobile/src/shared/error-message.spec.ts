import { errorMessage } from "./error-message"

describe("errorMessage", () => {
  it("returns the Error's message when given an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })

  it("returns the supplied fallback for a non-Error value", () => {
    expect(errorMessage("nope", "Не удалось загрузить")).toBe(
      "Не удалось загрузить",
    )
  })

  it("uses the default fallback when none is supplied", () => {
    expect(errorMessage(null)).toBe("Что-то пошло не так. Попробуйте ещё раз.")
  })
})
