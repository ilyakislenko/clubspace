import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

// List rows carry `unlockedBy`; create/update return the same base shape minus
// that (the page reloads the list after mutating, so items always have it).
export type Achievement = ApiTypes.ListAchievementsOutputOutput["data"][number]
export type AchievementMetric = Achievement["metric"]

export type AchievementInput = {
  name: string
  description?: string | null
  icon?: string | null
  metric: AchievementMetric
  threshold: number
  isActive?: boolean
  order?: number
}

export const listAchievements = async (params: {
  workspaceId: string
}): Promise<{ data: Achievement[] }> => {
  return await getApiClient().request<{ data: Achievement[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/achievements`,
  })
}

export const createAchievement = async (params: {
  workspaceId: string
  data: AchievementInput
}): Promise<Achievement> => {
  return await getApiClient().request<Achievement, AchievementInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/achievements`,
    data: params.data,
  })
}

export const updateAchievement = async (params: {
  workspaceId: string
  achievementId: string
  data: Partial<AchievementInput>
}): Promise<Achievement> => {
  return await getApiClient().request<Achievement, Partial<AchievementInput>>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/achievements/${params.achievementId}`,
    data: params.data,
  })
}

export const reorderAchievements = async (params: {
  workspaceId: string
  ids: string[]
}): Promise<{ data: Achievement[] }> => {
  return await getApiClient().request<{ data: Achievement[] }, { ids: string[] }>(
    {
      method: "post",
      url: `/workspaces/${params.workspaceId}/achievements/reorder`,
      data: { ids: params.ids },
    },
  )
}

export const seedDefaultAchievements = async (params: {
  workspaceId: string
}): Promise<{ data: Achievement[] }> => {
  return await getApiClient().request<{ data: Achievement[] }, undefined>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/achievements/seed-defaults`,
  })
}

export const deleteAchievement = async (params: {
  workspaceId: string
  achievementId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/achievements/${params.achievementId}`,
  })
}
