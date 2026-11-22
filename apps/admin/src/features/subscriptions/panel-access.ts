import { isSportLead, isStaff, type CurrentMembership } from "../../shared/lib/permissions"

// May the viewer of an (already opened) member profile load that member's
// abonements? The profile itself opens for members of the viewer's groups
// and for the viewer's own row, but the abonements endpoint refuses the own
// row of a coach scoped to their groups (server: assertCanReadMember with no
// self exception). Sport leads read every member. Undecided (who am I not
// loaded yet) = no, so the panel never fires a request that answers 403.
export const canOpenMemberSubscriptions = (
  membership: CurrentMembership | null | undefined,
  viewerUserId: string | null,
  memberUserId: string,
): boolean => {
  if (!isStaff(membership)) return false
  if (isSportLead(membership)) return true
  return viewerUserId !== null && viewerUserId !== memberUserId
}
