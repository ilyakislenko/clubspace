import { getApiClient } from "./client"

export type TagResponse = {
  id: string
  workspaceId: string
  type: string
  name: string
  slug: string
  description?: string | null
  createdAt: string
  updatedAt: string
}

export type TagPayload = {
  type: string
  name: string
  slug: string
  description?: string | null
}

export const listTags = async (params: { workspaceId: string; type?: string }) => {
  return await getApiClient().request<{ data: TagResponse[] }, undefined>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/tags`,
    params: { type: params.type },
  })
}

export const createTag = async (params: {
  workspaceId: string
  data: TagPayload
}) => {
  return await getApiClient().request<TagResponse, TagPayload>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/tags`,
    data: params.data,
  })
}

export const updateTag = async (params: {
  workspaceId: string
  tagId: string
  data: Partial<TagPayload>
}) => {
  return await getApiClient().request<TagResponse, Partial<TagPayload>>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/tags/${params.tagId}`,
    data: params.data,
  })
}

export const deleteTag = async (params: { workspaceId: string; tagId: string }) => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/tags/${params.tagId}`,
  })
}
