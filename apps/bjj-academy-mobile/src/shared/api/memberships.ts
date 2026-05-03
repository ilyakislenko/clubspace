import { getApiClient } from "./client"

export type WorkspaceMembership = {
  workspaceId: string
  workspaceName: string
  role: string
  status: string
  accessUntil: string | null
  createdAt: string
}

export const fetchMyMembership = async (params: {
  workspaceId: string
}): Promise<WorkspaceMembership> => {
  return await getApiClient().request<WorkspaceMembership>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/me`,
  })
}
