import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type CategoryResponse =
  ApiTypes.ListCategoriesOutputOutput["data"][number]

export type CategoryPayload = ApiTypes.CreateCategoryInput

export const listCategories = async (params: {
  workspaceId: string
  parentId?: string | null
}) => {
  return await getApiClient().request<{ data: CategoryResponse[] }, undefined>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/categories`,
    params: { parentId: params.parentId ?? undefined },
  })
}

export const createCategory = async (params: {
  workspaceId: string
  data: CategoryPayload
}) => {
  return await getApiClient().request<CategoryResponse, CategoryPayload>({
    method: "post",
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
    method: "patch",
    url: `/workspaces/${params.workspaceId}/categories/${params.categoryId}`,
    data: params.data,
  })
}

export const deleteCategory = async (params: {
  workspaceId: string
  categoryId: string
}) => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/categories/${params.categoryId}`,
  })
}
