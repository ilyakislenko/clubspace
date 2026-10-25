// A 403 usually means access just changed, so the app re-fetches its
// workspaces. If that refresh were itself followed by another refused call, the
// two would feed each other forever; this lets one 403-triggered refresh
// through at a time and at most one per window.
export const FORBIDDEN_REFRESH_WINDOW_MS = 30_000

export const createForbiddenRefreshGate = (
  windowMs: number = FORBIDDEN_REFRESH_WINDOW_MS,
  now: () => number = () => Date.now(),
) => {
  let inFlight = false
  let lastStartedAt = Number.NEGATIVE_INFINITY

  return async (refresh: () => Promise<void>): Promise<boolean> => {
    if (inFlight || now() - lastStartedAt < windowMs) return false
    inFlight = true
    lastStartedAt = now()
    try {
      await refresh()
    } finally {
      inFlight = false
    }
    return true
  }
}
