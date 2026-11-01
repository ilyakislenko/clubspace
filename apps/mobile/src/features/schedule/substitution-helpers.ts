import type { ScheduleSession } from "../../shared/api/groups"
import { shortPersonName } from "./schedule-calendar"

const DAY_MS = 24 * 60 * 60 * 1000
// The server records a forgotten substitution for the past week's classes.
const PAST_WINDOW_MS = 7 * DAY_MS

// What the schedule needs to know about a staff viewer to decide what a class
// offers them instead of a member's booking.
export type StaffViewer = {
  meId: string | null
  // The owner, an admin or a head coach: runs every group.
  adminScope: boolean
  // Marks every class without a substitution (admin scope, or a coach while
  // the club allows it) — the membership's marksAnyClass.
  marksAnyClass: boolean
  coachGroupIds: ReadonlySet<string>
  managedDirectionIds: ReadonlySet<string>
}

/** The owner, admins and head coaches run every group of the club. */
export const isAdminScope = (ws: {
  roleName: string
  isOwner: boolean
}): boolean => ws.isOwner || ["admin", "head_coach"].includes(ws.roleName)

/**
 * The viewer runs this class's group: coaches it, manages its direction, or
 * has admin scope. They assign substitutes and approve requests.
 */
export const runsGroupOf = (s: ScheduleSession, v: StaffViewer): boolean =>
  v.adminScope ||
  v.coachGroupIds.has(s.groupId) ||
  (!!s.group.direction && v.managedDirectionIds.has(s.group.direction.id))

/** The viewer is this class's approved substitute. */
export const substitutesFor = (
  s: ScheduleSession,
  meId: string | null,
): boolean =>
  !!meId &&
  s.substitution?.status === "APPROVED" &&
  s.substitution.substitute.id === meId

/** «Отметить посещаемость»: who runs the group, the substitute, or anyone allowed to mark every class. */
export const canMarkSession = (s: ScheduleSession, v: StaffViewer): boolean =>
  !s.cancelled &&
  (runsGroupOf(s, v) || v.marksAnyClass || substitutesFor(s, v.meId))

/** «Замена: И. Фамилия» for an approved one; staff also see a pending request. */
export const substitutionLine = (
  s: ScheduleSession,
  showPending: boolean,
): string | null => {
  const sub = s.substitution
  if (!sub) return null
  const name = shortPersonName(sub.substitute)
  if (sub.status === "APPROVED") return `Замена: ${name}`
  return showPending ? `Запрос на замену: ${name}` : null
}

export type SubstitutionAction =
  // Whoever runs the group puts (or swaps) a substitute on the class.
  | "assign"
  // A coach of another group offers to take the class.
  | "take"
  | "approve"
  | "decline"
  // The requester withdraws a pending request.
  | "withdraw"
  // An approved substitution is called off.
  | "cancel"

/** What the class sheet offers a staff viewer about its substitution. */
export const substitutionActions = (
  s: ScheduleSession,
  v: StaffViewer,
  now: number,
): SubstitutionAction[] => {
  if (s.cancelled) return []
  if (new Date(s.endAt).getTime() < now - PAST_WINDOW_MS) return []
  const runs = runsGroupOf(s, v)
  const sub = s.substitution
  const mine =
    !!sub &&
    !!v.meId &&
    (sub.substitute.id === v.meId || sub.requestedById === v.meId)
  if (!sub) {
    if (runs) return ["assign"]
    return v.coachGroupIds.has(s.groupId) ? [] : ["take"]
  }
  if (sub.status === "PENDING") {
    if (runs) return ["approve", "decline"]
    return mine ? ["withdraw"] : []
  }
  if (runs) return ["assign", "cancel"]
  return mine ? ["cancel"] : []
}
