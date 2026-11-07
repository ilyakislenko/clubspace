import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Мои планы»: the member's own study plans — moments and segments from
// different lessons, played back to back. Online-only edits; every item change
// answers with the whole plan.

export type StudyPlanSummary =
  ApiTypes.ListMyStudyPlansOutputOutput["items"][number]
export type StudyPlan = ApiTypes.GetMyStudyPlanOutputOutput
export type StudyPlanItem = StudyPlan["items"][number]
export type StudyPlanItemInput = ApiTypes.AddMyStudyPlanItemInput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/me/study-plans`

export const listMyStudyPlans = async (params: { workspaceId: string }) => {
  return await getApiClient().request<ApiTypes.ListMyStudyPlansOutputOutput>({
    method: "get",
    url: base(params.workspaceId),
  })
}

export const getMyStudyPlan = async (params: {
  workspaceId: string
  planId: string
}) => {
  return await getApiClient().request<StudyPlan>({
    method: "get",
    url: `${base(params.workspaceId)}/${params.planId}`,
  })
}

export const createMyStudyPlan = async (params: {
  workspaceId: string
  data: ApiTypes.CreateMyStudyPlanInput
}) => {
  return await getApiClient().request<
    ApiTypes.CreateMyStudyPlanOutputOutput,
    ApiTypes.CreateMyStudyPlanInput
  >({
    method: "post",
    url: base(params.workspaceId),
    data: params.data,
  })
}

export const updateMyStudyPlan = async (params: {
  workspaceId: string
  planId: string
  data: ApiTypes.UpdateMyStudyPlanInput
}) => {
  return await getApiClient().request<
    ApiTypes.UpdateMyStudyPlanOutputOutput,
    ApiTypes.UpdateMyStudyPlanInput
  >({
    method: "patch",
    url: `${base(params.workspaceId)}/${params.planId}`,
    data: params.data,
  })
}

export const deleteMyStudyPlan = async (params: {
  workspaceId: string
  planId: string
}) => {
  return await getApiClient().request<ApiTypes.DeleteMyStudyPlanOutputOutput>({
    method: "delete",
    url: `${base(params.workspaceId)}/${params.planId}`,
  })
}

export const addMyStudyPlanItem = async (params: {
  workspaceId: string
  planId: string
  data: StudyPlanItemInput
}) => {
  return await getApiClient().request<
    ApiTypes.AddMyStudyPlanItemOutputOutput,
    StudyPlanItemInput
  >({
    method: "post",
    url: `${base(params.workspaceId)}/${params.planId}/items`,
    data: params.data,
  })
}

export const updateMyStudyPlanItem = async (params: {
  workspaceId: string
  planId: string
  itemId: string
  data: ApiTypes.UpdateMyStudyPlanItemInput
}) => {
  return await getApiClient().request<
    ApiTypes.UpdateMyStudyPlanItemOutputOutput,
    ApiTypes.UpdateMyStudyPlanItemInput
  >({
    method: "patch",
    url: `${base(params.workspaceId)}/${params.planId}/items/${params.itemId}`,
    data: params.data,
  })
}

export const deleteMyStudyPlanItem = async (params: {
  workspaceId: string
  planId: string
  itemId: string
}) => {
  return await getApiClient().request<ApiTypes.DeleteMyStudyPlanItemOutputOutput>({
    method: "delete",
    url: `${base(params.workspaceId)}/${params.planId}/items/${params.itemId}`,
  })
}

// The whole plan's item ids in the new play order.
export const reorderMyStudyPlanItems = async (params: {
  workspaceId: string
  planId: string
  itemIds: string[]
}) => {
  return await getApiClient().request<
    ApiTypes.ReorderMyStudyPlanItemsOutputOutput,
    ApiTypes.ReorderMyStudyPlanItemsInput
  >({
    method: "put",
    url: `${base(params.workspaceId)}/${params.planId}/items/order`,
    data: { itemIds: params.itemIds },
  })
}
