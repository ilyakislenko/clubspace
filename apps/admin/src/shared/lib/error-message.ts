// Extracts a user-facing message from an unknown thrown value. Falls back to a
// generic save-failure message; callers pass a more specific fallback when the
// action isn't a "save".
//
// The server's explanation lives in the RESPONSE BODY, not on the Error. An
// axios rejection is an Error whose `.message` is "Request failed with status
// code 403", so reading `.message` first threw away every message the API took
// the trouble to write ("Free trial already used", "Cannot set access window
// for workspace owner") and showed HTTP noise instead. Body first, Error second.
type ApiErrorShape = {
  response?: { data?: { message?: unknown; error?: unknown; metadata?: unknown } }
}

const readServerMessage = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null
  const data = (error as ApiErrorShape).response?.data
  if (!data) return null

  // The API's error filter puts the text in `message`; some responses only
  // carry `error`. A validation failure can make `message` an array.
  const raw = data.message ?? data.error
  if (typeof raw === "string" && raw.trim()) return raw.trim()
  if (Array.isArray(raw)) {
    const joined = raw
      .filter((m): m is string => typeof m === "string")
      .join("; ")
      .trim()
    if (joined) return joined
  }
  return null
}

export const errorMessage = (
  error: unknown,
  fallback = "Не удалось сохранить изменения.",
): string => {
  const fromServer = readServerMessage(error)
  if (fromServer) return fromServer

  // A bare transport Error carries only boilerplate, which tells the user
  // nothing — prefer the caller's fallback in that case.
  if (
    error instanceof Error &&
    !/^Request failed with status code/.test(error.message)
  ) {
    return error.message
  }
  return fallback
}

/**
 * Seconds the server asks to wait before the next sign-in code (the resend
 * cooldown, `metadata.retryAfterSeconds`), or null for any other error.
 */
export const retryAfterSeconds = (error: unknown): number | null => {
  if (typeof error !== "object" || error === null) return null
  const metadata = (error as ApiErrorShape).response?.data?.metadata
  const raw =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined
  return typeof raw === "number" && raw > 0 ? Math.ceil(raw) : null
}
