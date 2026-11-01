// When a downloaded lesson may still be played. The server is the authority:
// the offline manifest is issued under the same gate as streaming (membership,
// course audience, trial limits — see docs/design/2026-11-01-content-gating.md),
// and a stored copy re-asks that gate (GET /videos/:id/playback) whenever the
// device is online. Offline, the copy plays only within a window after the last
// successful check, so a member whose access ended can't keep watching forever
// by staying offline.
//
// Pure: the web offline store feeds it timestamps and the server's answer.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// How long a download plays without the server confirming access again.
export const OFFLINE_ACCESS_WINDOW_MS = 14 * DAY_MS

// Online, re-ask the server at most this often per lesson from list screens;
// opening the lesson itself always re-asks.
export const OFFLINE_REVALIDATE_INTERVAL_MS = HOUR_MS

// A clock that moved back further than this since the last check is treated
// as tampering (winding the clock back would otherwise extend the window).
const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000

export type OfflineAccessVerdict = "allowed" | "denied" | "unreachable"

/**
 * Classifies a failed access check. 403 (locked: audience, rank, trial) and
 * 404 (gone, or hidden from this member) mean access is over. Anything else —
 * no response, 5xx, an expired session the auth layer is still refreshing — is
 * "can't tell right now", so the offline window decides.
 */
export const accessVerdictFromError = (error: unknown): OfflineAccessVerdict => {
  const response =
    typeof error === "object" && error !== null && "response" in error
      ? error.response
      : undefined
  const status =
    typeof response === "object" && response !== null && "status" in response
      ? response.status
      : undefined
  return status === 403 || status === 404 ? "denied" : "unreachable"
}

export const shouldRevalidateAccess = (p: {
  lastValidatedAt: number
  now: number
  online: boolean
  // Opening the lesson re-asks even inside the interval.
  force: boolean
}): boolean => {
  if (!p.online) return false
  if (p.force) return true
  return p.now - p.lastValidatedAt >= OFFLINE_REVALIDATE_INTERVAL_MS
}

export type OfflineAccessDecision = "ok" | "expired"

export const offlineAccessDecision = (p: {
  lastValidatedAt: number
  now: number
}): OfflineAccessDecision => {
  if (p.now < p.lastValidatedAt - CLOCK_SKEW_TOLERANCE_MS) return "expired"
  return p.now - p.lastValidatedAt > OFFLINE_ACCESS_WINDOW_MS ? "expired" : "ok"
}

// When the current window closes, for the "доступно офлайн до …" hint.
export const offlineAccessExpiresAt = (lastValidatedAt: number): number =>
  lastValidatedAt + OFFLINE_ACCESS_WINDOW_MS
