import { getApiClient, getSdkClient } from "./client"
import { getMyWorkspaces, type GetMyWorkspacesOutputOutput } from "../sdk"

export type WorkspaceSummary = GetMyWorkspacesOutputOutput["data"][number]

export const fetchWorkspaces = async (
  params: { curPage?: number; perPage?: number } = {}
): Promise<WorkspaceSummary[]> => {
  const response = await getMyWorkspaces({
    body: params,
    client: getSdkClient(),
    throwOnError: true,
  })

  return response.data.data ?? []
}

export type WorkspaceSettings = {
  id: string
  name: string
  coachSeesAllGroups: boolean
}

export const getWorkspaceSettings = async (params: {
  workspaceId: string
}) => {
  return await getApiClient().request<WorkspaceSettings>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/settings`,
  })
}

export const updateWorkspaceSettings = async (params: {
  workspaceId: string
  coachSeesAllGroups?: boolean
}) => {
  const { workspaceId, ...patch } = params
  return await getApiClient().request<WorkspaceSettings, typeof patch>({
    method: "patch",
    url: `/workspaces/${workspaceId}/settings`,
    data: patch,
  })
}
