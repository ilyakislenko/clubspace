import { errorCode, errorMessage, retryAfterSeconds } from "./error-message"

// Shape of what axios rejects with: an Error carrying transport boilerplate,
// plus the server's real explanation on `response.data`.
const axiosError = (data: unknown, status = 403) => {
  const e = new Error(`Request failed with status code ${status}`)
  return Object.assign(e, { response: { status, data } })
}

describe("errorMessage", () => {
  it("prefers the server's message over axios boilerplate", () => {
    expect(
      errorMessage(axiosError({ message: "Free trial already used" })),
    ).toBe("Free trial already used")
  })

  it("never surfaces the raw status-code text", () => {
    expect(errorMessage(axiosError({}), "Не удалось сохранить")).toBe(
      "Не удалось сохранить",
    )
  })

  it("falls back to `error` when there is no `message`", () => {
    expect(errorMessage(axiosError({ error: "Forbidden" }))).toBe("Forbidden")
  })

  it("joins an array of validation messages", () => {
    expect(
      errorMessage(axiosError({ message: ["name is required", "price must be a number"] })),
    ).toBe("name is required; price must be a number")
  })

  it("ignores a blank server message and uses the fallback", () => {
    expect(errorMessage(axiosError({ message: "   " }), "запасной")).toBe(
      "запасной",
    )
  })

  it("keeps a meaningful non-transport Error message", () => {
    expect(errorMessage(new Error("Файл слишком большой"))).toBe(
      "Файл слишком большой",
    )
  })

  it("uses the fallback for a non-Error throw", () => {
    expect(errorMessage("oops", "запасной")).toBe("запасной")
  })

  it("turns an unanswered request into a Russian connection message", () => {
    const offline = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      code: "ERR_NETWORK",
      request: {},
    })
    expect(errorMessage(offline, "запасной")).toBe(
      "Нет связи с сервером. Проверьте интернет и повторите.",
    )
    const timeout = Object.assign(new Error("timeout of 10000ms exceeded"), {
      isAxiosError: true,
      code: "ECONNABORTED",
      request: {},
    })
    expect(errorMessage(timeout)).toBe(
      "Нет связи с сервером. Проверьте интернет и повторите.",
    )
    expect(errorMessage(new Error("Network Error"))).toBe(
      "Нет связи с сервером. Проверьте интернет и повторите.",
    )
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe(
      "Нет связи с сервером. Проверьте интернет и повторите.",
    )
  })

  it("does not call an aborted request a connection problem", () => {
    const aborted = Object.assign(new Error("canceled"), {
      isAxiosError: true,
      code: "ERR_CANCELED",
      request: {},
    })
    expect(errorMessage(aborted, "запасной")).toBe("запасной")
  })

  it("uses the fallback for null", () => {
    expect(errorMessage(null, "запасной")).toBe("запасной")
  })
})

describe("retryAfterSeconds", () => {
  it("reads the resend cooldown from the response body", () => {
    const e = axiosError(
      {
        code: "USER_COMPLETE_CODE_TOO_EARLY",
        message: "Новый код можно запросить через 42 с",
        metadata: { retryAfterSeconds: 42 },
      },
      400,
    )
    expect(retryAfterSeconds(e)).toBe(42)
  })

  it("is null for any other error", () => {
    expect(retryAfterSeconds(axiosError({ metadata: {} }, 400))).toBeNull()
    expect(retryAfterSeconds(new Error("boom"))).toBeNull()
    expect(retryAfterSeconds(null)).toBeNull()
  })
})

describe("errorCode", () => {
  it("reads the API's code from the response body", () => {
    expect(errorCode(axiosError({ code: "TFA_CODE_REQUIRED" }, 400))).toBe(
      "TFA_CODE_REQUIRED",
    )
  })

  it("is null without one", () => {
    expect(errorCode(axiosError({ message: "x" }))).toBeNull()
    expect(errorCode(new Error("boom"))).toBeNull()
    expect(errorCode(null)).toBeNull()
  })
})
