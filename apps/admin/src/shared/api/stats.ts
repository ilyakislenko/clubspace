import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type WorkspaceStats = ApiTypes.GetWorkspaceStatsOutputOutput

export const getWorkspaceStats = async (params: { workspaceId: string }) => {
  return await getApiClient().request<WorkspaceStats>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/stats`,
  })
}
