import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type WorkspaceMembership = ApiTypes.GetMyWorkspaceMembershipOutputOutput

export const fetchMyMembership = async (params: {
  workspaceId: string
}): Promise<WorkspaceMembership> => {
  return await getApiClient().request<WorkspaceMembership>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/me`,
  })
}
