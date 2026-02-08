import { getApiClient } from "./client"

export type CategoryResponse = {
  id: string
  workspaceId: string
  name: string
  slug: string
  parentId?: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export type CategoryPayload = {
  name: string
  slug: string
  parentId?: string | null
  order?: number
}

export const listCategories = async (params: {
  workspaceId: string
  parentId?: string | null
}) => {
  return await getApiClient().request<{ data: CategoryResponse[] }, undefined>({
    method: "GET",
    url: `/workspaces/${params.workspaceId}/categories`,
    params: { parentId: params.parentId ?? undefined },
  })
}

export const createCategory = async (params: {
  workspaceId: string
  data: CategoryPayload
}) => {
  return await getApiClient().request<CategoryResponse, CategoryPayload>({
    method: "POST",
    url: `/workspaces/${params.workspaceId}/categories`,
    data: params.data,
  })
}

export const updateCategory = async (params: {
  workspaceId: string
  categoryId: string
  data: Partial<CategoryPayload>
}) => {
  return await getApiClient().request<CategoryResponse, Partial<CategoryPayload>>({
    method: "PATCH",
    url: `/workspaces/${params.workspaceId}/categories/${params.categoryId}`,
    data: params.data,
  })
}

export const deleteCategory = async (params: {
  workspaceId: string
  categoryId: string
}) => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "DELETE",
    url: `/workspaces/${params.workspaceId}/categories/${params.categoryId}`,
  })
}
