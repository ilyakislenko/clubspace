// Access-window segments the dashboard retention cards deep-link into
// (?filter=expiring|expired|inactive). Mirrors the server's expiringSoon /
// expiredAccess / inactiveMembers30d definitions (14-day horizon, 30-day
// window), which count students only.
const MS_1D = 24 * 3600 * 1000
const MS_14D = 14 * MS_1D
const MS_30D = 30 * MS_1D

export type AccessFilter = "all" | "expiring" | "expired" | "inactive"

// admin / head_coach / coach — the roles the server keeps out of every
// student counter (STAFF_ROLES).
const STAFF_ROLE_NAMES = new Set(["admin", "head_coach", "coach"])

export const matchesAccessFilter = (
  member: {
    isOwner: boolean
    roleName: string | null
    status: string
    accessUntil: string | null
    lastCheckInAt: string | null
  },
  filter: AccessFilter,
): boolean => {
  if (filter === "all") return true
  // The owner and staff aren't students: no churn/renewal risk, and the
  // dashboard counters leave them out, so the segments must too.
  if (member.isOwner || STAFF_ROLE_NAMES.has(member.roleName ?? "")) {
    return false
  }
  if (filter === "inactive") {
    // Active members with no check-in in the last 30 days (incl. never) —
    // matches the dashboard's inactiveMembers30d.
    if (member.status !== "ACTIVE") return false
    if (!member.lastCheckInAt) return true
    return new Date(member.lastCheckInAt).getTime() < Date.now() - MS_30D
  }
  if (!member.accessUntil) return false
  const until = new Date(member.accessUntil).getTime()
  const now = Date.now()
  if (filter === "expired") return until < now
  return until >= now && until < now + MS_14D
}
