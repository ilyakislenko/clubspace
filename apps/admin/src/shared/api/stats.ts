import { getApiClient } from "./client"

export type WorkspaceStats = {
  counts: {
    videos: number
    videosReady: number
    courses: number
    members: number
  }
  recentEvents: Array<{
    id: string
    action: string
    targetType: string
    targetId: string | null
    actorEmail: string | null
    createdAt: string
  }>
}

export const getWorkspaceStats = async (params: { workspaceId: string }) => {
  return await getApiClient().request<WorkspaceStats>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/stats`,
  })
}
