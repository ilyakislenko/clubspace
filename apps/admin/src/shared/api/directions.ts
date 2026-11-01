import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Direction = ApiTypes.DirectionOutputDtoOutput
export type DirectionInput = ApiTypes.CreateDirectionInput
export type DirectionUpdate = ApiTypes.UpdateDirectionInput
// Compact `{ id, name, color, icon }` reference embedded in tagged rows
// (groups, ladders, events, announcements).
export type DirectionRef = NonNullable<ApiTypes.RankLadderOutputDtoOutput["direction"]>

export const listDirections = async (params: {
  workspaceId: string
}): Promise<{ data: Direction[] }> => {
  return await getApiClient().request<{ data: Direction[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/directions`,
  })
}

export const createDirection = async (params: {
  workspaceId: string
  data: DirectionInput
}): Promise<Direction> => {
  return await getApiClient().request<Direction, DirectionInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/directions`,
    data: params.data,
  })
}

export const updateDirection = async (params: {
  workspaceId: string
  directionId: string
  data: DirectionUpdate
}): Promise<Direction> => {
  return await getApiClient().request<Direction, DirectionUpdate>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/directions/${params.directionId}`,
    data: params.data,
  })
}

export const deleteDirection = async (params: {
  workspaceId: string
  directionId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/directions/${params.directionId}`,
  })
}
