import { type WorkspaceMember } from "../../shared/api/members"
import { canManageGroups } from "../../shared/lib/permissions"

// Members the server accepts as a group coach (owner is always allowed).
export const isCoachCapable = (m: WorkspaceMember): boolean =>
  canManageGroups({ role: m.roleName, isOwner: m.isOwner })

export const formatMemberLabel = (m: WorkspaceMember): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email
}
