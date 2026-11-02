import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type RankReadiness = ApiTypes.GetRankReadinessOutputOutput
export type RankReadinessEntry = RankReadiness["data"][number]

// Staff only: who on a ladder has met the admission rule for their next level
// (a coach sees their own groups). Without `ladderId` the club's first ladder.
export const getRankReadiness = async (params: {
  workspaceId: string
  ladderId?: string
}): Promise<RankReadiness> =>
  await getApiClient().request<RankReadiness>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/rank-readiness`,
    params: { ladderId: params.ladderId },
  })
