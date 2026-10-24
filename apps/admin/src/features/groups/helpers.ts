import { type WorkspaceMember } from "../../shared/api/members"

// Roles the server accepts as a group coach (the owner is always allowed).
const COACH_ROLES = new Set(["admin", "head_coach", "coach"])

export const isCoachCapable = (m: WorkspaceMember): boolean =>
  m.isOwner || COACH_ROLES.has(m.roleName)

export const formatMemberLabel = (m: WorkspaceMember): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email
}
