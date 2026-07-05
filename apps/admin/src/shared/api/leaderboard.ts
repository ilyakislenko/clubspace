import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Leaderboard = ApiTypes.AttendanceLeaderboardOutputOutput
export type LeaderboardEntry = Leaderboard["entries"][number]
export type LeaderboardPeriod = Leaderboard["period"]

// The workspace attendance leaderboard. Same endpoint the mobile app uses;
// staff read it to see who's training most (and who's slipping).
export const getLeaderboard = async (params: {
  workspaceId: string
  period?: LeaderboardPeriod
}) => {
  const qs = params.period ? `?period=${params.period}` : ""
  return await getApiClient().request<Leaderboard>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/leaderboard${qs}`,
  })
}
