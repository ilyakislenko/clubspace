import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Leaderboard = ApiTypes.AttendanceLeaderboardOutputOutput
export type LeaderboardEntry = Leaderboard["entries"][number]
export type LeaderboardPeriod = Leaderboard["period"]

// The workspace's attendance leaderboard for a period ("week" | "month"),
// plus the caller's own line (rank/streak/hidden). `enabled` is false when the
// club owner turned the board off.
export const getLeaderboard = async (params: {
  workspaceId: string
  period?: LeaderboardPeriod
}): Promise<Leaderboard> => {
  const qs = params.period ? `?period=${params.period}` : ""
  return await getApiClient().request<Leaderboard>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/leaderboard${qs}`,
  })
}

// Opt the caller in/out of the public board for this workspace.
export const setLeaderboardVisibility = async (params: {
  workspaceId: string
  hidden: boolean
}): Promise<ApiTypes.SetLeaderboardVisibilityOutputOutput> =>
  await getApiClient().request<
    ApiTypes.SetLeaderboardVisibilityOutputOutput,
    ApiTypes.SetLeaderboardVisibilityInput
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/me/leaderboard-visibility`,
    data: { hidden: params.hidden },
  })
