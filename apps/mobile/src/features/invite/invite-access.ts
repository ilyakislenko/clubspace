import type { WorkspaceSummary } from "../../shared/api/workspaces"

type Access = Pick<WorkspaceSummary, "roleName" | "isOwner"> | null | undefined

/** Who may show the club's code / QR: the owner and every staff role. */
export const canSeeClubInvite = (ws: Access): boolean =>
  !!ws && (ws.isOwner || ["admin", "head_coach", "coach"].includes(ws.roleName))

/** Who may accept or decline a join request: the owner, admins, head coaches. */
export const canDecideRequests = (ws: Access): boolean =>
  !!ws && (ws.isOwner || ["admin", "head_coach"].includes(ws.roleName))
