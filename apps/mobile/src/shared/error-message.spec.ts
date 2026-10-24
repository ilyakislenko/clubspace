import { errorMessage } from "./error-message"

const axiosError = (over: Record<string, unknown>) =>
  Object.assign(new Error("Request failed with status code 400"), over)

describe("errorMessage", () => {
  it("returns the Error's message when given a plain Error", () => {
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

  it("prefers the server's message from the response body", () => {
    const e = axiosError({
      response: { status: 400, data: { message: "Неверный код" } },
    })
    expect(errorMessage(e, "fb")).toBe("Неверный код")
  })

  it("joins an array message", () => {
    const e = axiosError({
      response: { status: 400, data: { message: ["а", "б"] } },
    })
    expect(errorMessage(e)).toBe("а; б")
  })

  it("never shows 'Request failed…' — uses the fallback", () => {
    const e = axiosError({ response: { status: 404, data: {} } })
    expect(errorMessage(e, "Не удалось загрузить")).toBe("Не удалось загрузить")
  })

  it.each(["ECONNABORTED", "ERR_NETWORK", "ETIMEDOUT"])(
    "maps %s to the offline message",
    (code) => {
      const e = Object.assign(new Error("Network Error"), { code })
      expect(errorMessage(e, "fb")).toBe(
        "Нет подключения к интернету. Проверьте сеть и попробуйте ещё раз.",
      )
    },
  )

  it("maps a 5xx without a message to the server-unavailable text", () => {
    const e = axiosError({ response: { status: 503, data: "" } })
    expect(errorMessage(e, "fb")).toBe(
      "Сервер временно недоступен. Попробуйте позже.",
    )
  })

  it("falls back for a bare 'Network Error' without a code", () => {
    expect(errorMessage(new Error("Network Error"), "fb")).toBe("fb")
  })
})
