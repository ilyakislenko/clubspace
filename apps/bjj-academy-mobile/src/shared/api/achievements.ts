import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Achievements = ApiTypes.MyAchievementsOutputOutput
export type Milestone = Achievements["milestones"][number]

// The current member's own attendance achievements: total check-ins, current +
// longest weekly streak, and unlocked/locked milestones. Read-only.
export const getMyAchievements = async (params: {
  workspaceId: string
}): Promise<Achievements> =>
  await getApiClient().request<Achievements>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/achievements`,
  })
