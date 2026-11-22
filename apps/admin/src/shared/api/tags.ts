import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead, invalidateReads } from "./read-cache"

export type TagResponse = ApiTypes.ListTagsOutputOutput["data"][number]

export type TagPayload = ApiTypes.CreateTagInput

// The content page and its video list ask at once: shared while in flight,
// never kept.
export const listTags = (params: { workspaceId: string; type?: string }) =>
  cachedRead(`tags:${params.workspaceId}:${params.type ?? ""}`, () =>
    getApiClient().request<{ data: TagResponse[] }, undefined>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/tags`,
      params: { type: params.type },
    }),
  )

export const createTag = async (params: {
  workspaceId: string
  data: TagPayload
}) => {
  const tag = await getApiClient().request<TagResponse, TagPayload>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/tags`,
    data: params.data,
  })
  invalidateReads(`tags:${params.workspaceId}`)
  return tag
}

export const updateTag = async (params: {
  workspaceId: string
  tagId: string
  data: Partial<TagPayload>
}) => {
  const tag = await getApiClient().request<TagResponse, Partial<TagPayload>>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/tags/${params.tagId}`,
    data: params.data,
  })
  invalidateReads(`tags:${params.workspaceId}`)
  return tag
}

export const deleteTag = async (params: { workspaceId: string; tagId: string }) => {
  const result = await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/tags/${params.tagId}`,
  })
  invalidateReads(`tags:${params.workspaceId}`)
  return result
}
