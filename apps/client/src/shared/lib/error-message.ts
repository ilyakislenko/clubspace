// Extracts a user-facing message from an unknown thrown value, falling back to
// a caller-supplied message (every call site passes one specific to its action).
//
// The server's explanation lives in the RESPONSE BODY, not on the Error: an
// axios rejection's `.message` is "Request failed with status code 400", so the
// body is read first. Never surface axios' English boilerplate.
type ApiErrorShape = {
  response?: { status?: number; data?: { message?: unknown; error?: unknown } }
  request?: unknown
}

const readServerMessage = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null
  const data = (error as ApiErrorShape).response?.data
  if (!data) return null

  // `message` is a string, or an array for validation failures; some
  // responses only carry `error`.
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
  fallback = "Что-то пошло не так. Попробуйте ещё раз.",
): string => {
  const fromServer = readServerMessage(error)
  if (fromServer) return fromServer

  if (typeof error === "object" && error !== null) {
    const { response, request } = error as ApiErrorShape
    if (!response && request) {
      return "Нет подключения к интернету. Проверьте соединение и повторите."
    }
    if (response?.status !== undefined && response.status >= 500) {
      return "Сервер временно недоступен. Попробуйте позже."
    }
  }

  if (
    error instanceof Error &&
    !/^(Request failed with status code|Network Error|timeout of)/.test(
      error.message,
    )
  ) {
    return error.message
  }
  if (error instanceof Error && error.message === "Network Error") {
    return "Нет подключения к интернету. Проверьте соединение и повторите."
  }
  return fallback
}
