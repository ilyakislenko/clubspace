// Recognises the API's answers that concern the personal-data consent gate.
// The code lives in the response body; the axios Error only says "403".
type ApiErrorShape = {
  response?: { status?: number; data?: { code?: unknown } }
}

const readResponse = (error: unknown): ApiErrorShape["response"] =>
  typeof error === "object" && error !== null
    ? (error as ApiErrorShape).response
    : undefined

// 403 CONSENT_REQUIRED: the account has not accepted the current edition, so
// every club endpoint is refused until it does.
export const isConsentRequiredError = (error: unknown): boolean => {
  const response = readResponse(error)
  return response?.status === 403 && response.data?.code === "CONSENT_REQUIRED"
}

// 409 on accept: the edition changed between showing and accepting it.
export const isConsentConflictError = (error: unknown): boolean =>
  readResponse(error)?.status === 409
