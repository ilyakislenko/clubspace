import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// A member's QR card for the door, to print for a child without a phone:
// `qrPngDataUrl` is the picture, `name` whom it belongs to.
export type MemberCheckInCard = ApiTypes.MemberCheckInCardOutputOutput

export const getMemberCheckInCard = async (params: {
  workspaceId: string
  userId: string
}): Promise<MemberCheckInCard> =>
  await getApiClient().request<MemberCheckInCard>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/check-in-card`,
  })
