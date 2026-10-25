import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MyRankProgress = ApiTypes.MyRankProgressOutputOutput
export type RankProgressEntry = MyRankProgress["data"][number]

// How far the member is from the next level's admission rule, plus the grading
// they are listed for. Read-only.
export const getMyRankProgress = async (params: {
  workspaceId: string
}): Promise<MyRankProgress> =>
  await getApiClient().request<MyRankProgress>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/rank-progress`,
  })
