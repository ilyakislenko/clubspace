import { getApiClient, getSdkClient } from "./client"
import { getMyWorkspaces, type GetMyWorkspacesOutputOutput } from "../sdk"

// SDK regen lags behind hand-edited features — `roleName` + `isOwner`
// are returned by the live server even when the generated type doesn't
// know about them yet. Intersection keeps the type accurate at runtime
// without forcing a full SDK rebuild on every server change.
export type WorkspaceSummary = GetMyWorkspacesOutputOutput["data"][number] & {
  roleName: string
  isOwner: boolean
}

export const fetchWorkspaces = async (
  params: { curPage?: number; perPage?: number } = {}
): Promise<WorkspaceSummary[]> => {
  const response = await getMyWorkspaces({
    body: params,
    client: getSdkClient(),
    throwOnError: true,
  })

  // SDK type predates the roleName/isOwner fields. Cast through unknown
  // because the runtime payload definitely contains them since #38.
  return (response.data.data ?? []) as unknown as WorkspaceSummary[]
}

export type WorkspaceSettings = {
  id: string
  name: string
  coachSeesAllGroups: boolean
  timezone: string
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
  timezone?: string
}) => {
  const { workspaceId, ...patch } = params
  return await getApiClient().request<WorkspaceSettings, typeof patch>({
    method: "patch",
    url: `/workspaces/${workspaceId}/settings`,
    data: patch,
  })
}
