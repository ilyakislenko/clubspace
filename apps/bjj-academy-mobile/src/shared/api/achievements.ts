import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Achievements = ApiTypes.MyAchievementsOutputOutput
export type Achievement = Achievements["achievements"][number]

// The current member's own achievements: total check-ins, current + longest
// weekly streak, and the club's configured (or default) badges. Read-only.
export const getMyAchievements = async (params: {
  workspaceId: string
}): Promise<Achievements> =>
  await getApiClient().request<Achievements>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/achievements`,
  })
