import {
  isConsentConflictError,
  isConsentRequiredError,
} from "./consent-required"

const apiError = (status: number, data?: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  })

describe("isConsentRequiredError", () => {
  it("recognises 403 CONSENT_REQUIRED", () => {
    expect(
      isConsentRequiredError(
        apiError(403, {
          code: "CONSENT_REQUIRED",
          message: "Примите согласие на обработку персональных данных",
        }),
      ),
    ).toBe(true)
  })

  it("ignores other 403s and other statuses carrying the code", () => {
    expect(isConsentRequiredError(apiError(403, { code: "FORBIDDEN" }))).toBe(
      false,
    )
    expect(isConsentRequiredError(apiError(403))).toBe(false)
    expect(
      isConsentRequiredError(apiError(400, { code: "CONSENT_REQUIRED" })),
    ).toBe(false)
  })

  it("ignores values that are not API errors", () => {
    expect(isConsentRequiredError(null)).toBe(false)
    expect(isConsentRequiredError("CONSENT_REQUIRED")).toBe(false)
    expect(isConsentRequiredError(new Error("Network Error"))).toBe(false)
  })
})

describe("isConsentConflictError", () => {
  it("recognises a 409 only", () => {
    expect(isConsentConflictError(apiError(409, { code: "CONFLICT" }))).toBe(
      true,
    )
    expect(isConsentConflictError(apiError(403))).toBe(false)
    expect(isConsentConflictError(undefined)).toBe(false)
  })
})
