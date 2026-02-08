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
    method: "GET",
    url: `/workspaces/${params.workspaceId}/tags`,
    params: { type: params.type },
  })
}

export const createTag = async (params: {
  workspaceId: string
  data: TagPayload
}) => {
  return await getApiClient().request<TagResponse, TagPayload>({
    method: "POST",
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
    method: "PATCH",
    url: `/workspaces/${params.workspaceId}/tags/${params.tagId}`,
    data: params.data,
  })
}

export const deleteTag = async (params: { workspaceId: string; tagId: string }) => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "DELETE",
    url: `/workspaces/${params.workspaceId}/tags/${params.tagId}`,
  })
}
