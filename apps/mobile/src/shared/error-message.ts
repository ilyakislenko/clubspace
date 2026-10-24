// Extracts a user-facing message from an unknown thrown value, falling back to
// a caller-supplied message (every call site passes one specific to its action).
//
// The server's explanation lives in the RESPONSE BODY, not on the Error: an
// axios rejection's `.message` is "Request failed with status code 400". Body
// first, then transport problems (offline / timeout), then the caller's fallback.
type ApiErrorShape = {
  code?: unknown
  response?: { status?: unknown; data?: { message?: unknown; error?: unknown } }
}

const OFFLINE_MESSAGE = "Нет подключения к интернету. Проверьте сеть и попробуйте ещё раз."
const SERVER_DOWN_MESSAGE = "Сервер временно недоступен. Попробуйте позже."

const readServerMessage = (error: ApiErrorShape): string | null => {
  const data = error.response?.data
  if (!data || typeof data !== "object") return null
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

const isNetworkError = (error: ApiErrorShape): boolean =>
  !error.response &&
  (error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ERR_NETWORK")

export const errorMessage = (
  error: unknown,
  fallback = "Что-то пошло не так. Попробуйте ещё раз.",
): string => {
  if (typeof error === "object" && error !== null) {
    const api = error as ApiErrorShape
    const fromServer = readServerMessage(api)
    if (fromServer) return fromServer
    if (isNetworkError(api)) return OFFLINE_MESSAGE
    const status = api.response?.status
    if (typeof status === "number" && status >= 500) return SERVER_DOWN_MESSAGE
  }
  if (
    error instanceof Error &&
    !/^Request failed with status code/.test(error.message) &&
    error.message !== "Network Error"
  ) {
    return error.message
  }
  return fallback
}
