import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// The member's personal QR card: `card` is the scanned text, `qrPngDataUrl`
// its picture. One card per person (the same in every club); in a child's
// profile (X-Act-As) it is the child's.
export type CheckInCard = ApiTypes.MyCheckInCardOutputOutput
// Who a scanned card belongs to in this club, and whether they are marked.
export type CardLookup = ApiTypes.LookupCheckInCardOutputOutput

export const getMyCheckInCard = async (params: {
  workspaceId: string
}): Promise<CheckInCard> =>
  await getApiClient().request<CheckInCard>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/check-in-card`,
  })

// Resolves a scanned card for the coach's session without writing anything;
// the mark itself is the regular `records` call.
export const lookupCheckInCard = async (params: {
  workspaceId: string
  sessionId: string
  card: string
}): Promise<CardLookup> =>
  await getApiClient().request<CardLookup, ApiTypes.LookupCheckInCardInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/attendance/sessions/${params.sessionId}/card-lookup`,
    data: { card: params.card },
  })
