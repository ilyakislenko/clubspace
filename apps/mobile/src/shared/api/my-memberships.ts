import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// Leaves a club. The server refuses (400, Russian message) for the club owner
// and for a group's primary coach.
export const leaveWorkspace = async (workspaceId: string) => {
  return await getApiClient().request<ApiTypes.LeaveWorkspaceOutputOutput>({
    method: "delete",
    url: `/me/memberships/${workspaceId}`,
  })
}

// Muted: only the club's important notifications (payment, access, membership,
// booking changes) still arrive.
export const setWorkspaceNotificationsMuted = async (
  workspaceId: string,
  muted: boolean,
) => {
  return await getApiClient().request<
    ApiTypes.UpdateMembershipNotificationsOutputOutput,
    ApiTypes.UpdateMembershipNotificationsBody
  >({
    method: "patch",
    url: `/me/memberships/${workspaceId}/notifications`,
    data: { muted },
  })
}
