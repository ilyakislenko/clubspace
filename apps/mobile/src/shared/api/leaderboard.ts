import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Leaderboard = ApiTypes.AttendanceLeaderboardOutputOutput
export type LeaderboardEntry = Leaderboard["entries"][number]
export type LeaderboardPeriod = Leaderboard["period"]

// The workspace's attendance leaderboard for a period ("week" | "month"),
// plus the caller's own line (rank/streak/hidden). `enabled` is false when the
// club owner turned the board off. `directionId` ranks only that direction's
// check-ins (omitted = the whole club).
export const getLeaderboard = async (params: {
  workspaceId: string
  period?: LeaderboardPeriod
  directionId?: string | null
}): Promise<Leaderboard> =>
  await getApiClient().request<Leaderboard>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/leaderboard`,
    params: {
      ...(params.period ? { period: params.period } : {}),
      ...(params.directionId ? { directionId: params.directionId } : {}),
    },
  })

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
