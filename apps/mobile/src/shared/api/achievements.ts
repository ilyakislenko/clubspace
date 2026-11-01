import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Achievements = ApiTypes.MyAchievementsOutputOutput
// `directionId` null = a club-wide badge.
export type Achievement = Achievements["achievements"][number]
// A direction the member trains in that has its own badges, with that
// direction's own totals (the top-level totals stay club-wide).
export type AchievementDirection = Achievements["directions"][number]

// The current member's own achievements: total check-ins, current + longest
// weekly streak, and the club's configured (or default) badges. Read-only.
export const getMyAchievements = async (params: {
  workspaceId: string
}): Promise<Achievements> =>
  await getApiClient().request<Achievements>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/achievements`,
  })
