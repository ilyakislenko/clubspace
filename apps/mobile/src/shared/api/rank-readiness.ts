import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type RankReadiness = ApiTypes.GetRankReadinessOutputOutput
export type RankReadinessEntry = RankReadiness["data"][number]

// Staff only: who on a ladder has met the admission rule for their next level
// (a coach sees their own groups). Without `ladderId` the club's first ladder.
// One page (`perPage`, the server caps it); `summary` counts the whole ladder.
export const getRankReadiness = async (params: {
  workspaceId: string
  ladderId?: string
  readyOnly?: boolean
  perPage?: number
}): Promise<RankReadiness> =>
  await getApiClient().request<RankReadiness>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/rank-readiness`,
    params: {
      ladderId: params.ladderId,
      readyOnly: params.readyOnly,
      perPage: params.perPage,
    },
  })
