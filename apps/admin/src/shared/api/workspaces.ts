import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient, getSdkClient } from "./client"
import { getMyWorkspaces } from "../sdk"

// Sourced from the drift-gated shared contract, which already carries
// roleName + isOwner — so the old intersection hack against the (laggier)
// local SDK type is no longer needed.
export type WorkspaceSummary =
  ApiTypes.GetMyWorkspacesOutputOutput["data"][number]

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

export type WorkspaceSettings = ApiTypes.GetWorkspaceSettingsOutputOutput

export const getWorkspaceSettings = async (params: {
  workspaceId: string
}) => {
  return await getApiClient().request<WorkspaceSettings>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/settings`,
  })
}

// Any mutable settings field can be PATCHed (all optional). Derived from the
// contract so new app-section flags are accepted automatically.
export type WorkspaceSettingsPatch = Partial<
  Omit<WorkspaceSettings, "id" | "name">
>

export const updateWorkspaceSettings = async (
  params: { workspaceId: string } & WorkspaceSettingsPatch
) => {
  const { workspaceId, ...patch } = params
  return await getApiClient().request<WorkspaceSettings, typeof patch>({
    method: "patch",
    url: `/workspaces/${workspaceId}/settings`,
    data: patch,
  })
}
