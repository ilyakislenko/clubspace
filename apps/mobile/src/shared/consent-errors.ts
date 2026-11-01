// Until the current edition of the personal-data consent is accepted, the
// server refuses every authenticated call except /me, account deletion, the
// data export and /me/consent itself with this 403 code. It is not an access
// change: the app routes back to the consent screen instead of refreshing
// workspaces or showing an error.
export const CONSENT_REQUIRED_CODE = "CONSENT_REQUIRED"

type HttpErrorShape = {
  response?: { status?: unknown; data?: { code?: unknown } | null }
}

const responseOf = (error: unknown): HttpErrorShape["response"] =>
  typeof error === "object" && error !== null
    ? (error as HttpErrorShape).response
    : undefined

export const isConsentRequiredError = (error: unknown): boolean => {
  const response = responseOf(error)
  return (
    response?.status === 403 &&
    response.data?.code === CONSENT_REQUIRED_CODE
  )
}

// POST /me/consent answers 409 when a newer edition was published after the
// one the user was shown; the screen re-reads it and asks again.
export const isConsentConflictError = (error: unknown): boolean =>
  responseOf(error)?.status === 409
