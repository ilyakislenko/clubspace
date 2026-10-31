import {
  CONSENT_REQUIRED_CODE,
  isConsentConflictError,
  isConsentRequiredError,
} from "./consent-errors"

const httpError = (status?: number, data?: unknown) => ({
  response: status ? { status, data } : undefined,
})

describe("isConsentRequiredError", () => {
  it("matches the consent gate's 403", () => {
    expect(
      isConsentRequiredError(
        httpError(403, {
          code: CONSENT_REQUIRED_CODE,
          message: "Примите согласие на обработку персональных данных",
        }),
      ),
    ).toBe(true)
  })

  it("ignores other 403s — those are access changes", () => {
    expect(isConsentRequiredError(httpError(403, { code: "FORBIDDEN" }))).toBe(
      false,
    )
    expect(isConsentRequiredError(httpError(403))).toBe(false)
    expect(isConsentRequiredError(httpError(403, null))).toBe(false)
  })

  it("ignores the code on any other status and non-HTTP errors", () => {
    expect(
      isConsentRequiredError(httpError(400, { code: CONSENT_REQUIRED_CODE })),
    ).toBe(false)
    expect(isConsentRequiredError(httpError(undefined))).toBe(false)
    expect(isConsentRequiredError(new Error("Network Error"))).toBe(false)
    expect(isConsentRequiredError(null)).toBe(false)
    expect(isConsentRequiredError("CONSENT_REQUIRED")).toBe(false)
  })
})

describe("isConsentConflictError", () => {
  it("is true only for a 409", () => {
    expect(isConsentConflictError(httpError(409, { code: "CONFLICT" }))).toBe(
      true,
    )
    expect(isConsentConflictError(httpError(400))).toBe(false)
    expect(isConsentConflictError(new Error("boom"))).toBe(false)
    expect(isConsentConflictError(undefined)).toBe(false)
  })
})
