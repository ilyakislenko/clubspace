import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead, invalidateReads } from "./read-cache"

export type CategoryResponse =
  ApiTypes.ListCategoriesOutputOutput["data"][number]

export type CategoryPayload = ApiTypes.CreateCategoryInput

// The content page and its video list ask at once: shared while in flight,
// never kept.
export const listCategories = (params: {
  workspaceId: string
  parentId?: string | null
}) =>
  cachedRead(`categories:${params.workspaceId}:${params.parentId ?? ""}`, () =>
    getApiClient().request<{ data: CategoryResponse[] }, undefined>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/categories`,
      params: { parentId: params.parentId ?? undefined },
    }),
  )

export const createCategory = async (params: {
  workspaceId: string
  data: CategoryPayload
}) => {
  const category = await getApiClient().request<CategoryResponse, CategoryPayload>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/categories`,
    data: params.data,
  })
  invalidateReads(`categories:${params.workspaceId}`)
  return category
}

export const updateCategory = async (params: {
  workspaceId: string
  categoryId: string
  data: Partial<CategoryPayload>
}) => {
  const category = await getApiClient().request<
    CategoryResponse,
    Partial<CategoryPayload>
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/categories/${params.categoryId}`,
    data: params.data,
  })
  invalidateReads(`categories:${params.workspaceId}`)
  return category
}

export const deleteCategory = async (params: {
  workspaceId: string
  categoryId: string
}) => {
  const result = await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/categories/${params.categoryId}`,
  })
  invalidateReads(`categories:${params.workspaceId}`)
  return result
}
