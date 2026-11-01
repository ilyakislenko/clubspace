import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Руководитель направления»: a coach assigned to run one direction.
export type DirectionManager = ApiTypes.DirectionManagerOutputDtoOutput
export type AssignDirectionManagerInput = ApiTypes.AssignDirectionManagerInput

export const listDirectionManagers = async (params: {
  workspaceId: string
}): Promise<{ data: DirectionManager[] }> => {
  return await getApiClient().request<{ data: DirectionManager[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/direction-managers`,
  })
}

export const assignDirectionManager = async (params: {
  workspaceId: string
  data: AssignDirectionManagerInput
}): Promise<DirectionManager> => {
  return await getApiClient().request<
    DirectionManager,
    AssignDirectionManagerInput
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/direction-managers`,
    data: params.data,
  })
}

export const removeDirectionManager = async (params: {
  workspaceId: string
  managerId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/direction-managers/${params.managerId}`,
  })
}
