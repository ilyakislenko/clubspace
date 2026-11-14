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
  isAxiosError?: unknown
  code?: unknown
  request?: unknown
  response?: {
    data?: { message?: unknown; error?: unknown; metadata?: unknown; code?: unknown }
  }
}

export const NO_CONNECTION_MESSAGE =
  "Нет связи с сервером. Проверьте интернет и повторите."

// The request never got an answer (offline, refused, timed out, CORS): axios
// rejects without `response`, with English text like "Network Error" or
// "timeout of 10000ms exceeded"; a raw `fetch` (S3 uploads) rejects with a
// TypeError ("Failed to fetch" / "Load failed" / "NetworkError when attempting
// to fetch resource."). None of that may reach the screen.
const isTransportFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false
  const e = error as ApiErrorShape
  // An aborted request (ERR_CANCELED) is not a connection problem.
  if (e.response || e.code === "ERR_CANCELED") return false
  if (e.isAxiosError === true || e.request !== undefined) return true
  if (
    error instanceof TypeError &&
    /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/.test(
      error.message,
    )
  ) {
    return true
  }
  return (
    error instanceof Error &&
    /^(Network Error|timeout of \d+ms exceeded)$/.test(error.message)
  )
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

  if (isTransportFailure(error)) return NO_CONNECTION_MESSAGE

  // Otherwise an axios rejection carries only boilerplate ("Request failed
  // with status code 500", "canceled") — prefer the caller's fallback.
  if (
    error instanceof Error &&
    !/^Request failed with status code/.test(error.message) &&
    (error as ApiErrorShape).code !== "ERR_CANCELED"
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

/** The API's error code (`TFA_CODE_REQUIRED`, `PLATFORM_MFA_REQUIRED`, …), or null. */
export const errorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null
  const code = (error as ApiErrorShape).response?.data?.code
  return typeof code === "string" ? code : null
}
