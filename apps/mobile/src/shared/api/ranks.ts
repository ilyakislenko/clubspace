import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MyRanks = ApiTypes.MyRanksOutputOutput
export type Promotion = MyRanks["history"][number]

// The current member's own ranks: the latest promotion per ladder (current)
// plus the full promotion history. Coach-awarded — read-only for the member.
export const getMyRanks = async (params: {
  workspaceId: string
}): Promise<MyRanks> =>
  await getApiClient().request<MyRanks>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/ranks`,
  })
