import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type AuditEvent = ApiTypes.ListAuditEventsOutputOutput["data"][number]

export const listAuditEvents = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
  actionPrefix?: string
}) => {
  return await getApiClient().request<{
    data: AuditEvent[]
    total: number
    curPage: number
    perPage: number
  }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/audit-events`,
    params: {
      curPage: params.curPage,
      perPage: params.perPage,
      actionPrefix: params.actionPrefix || undefined,
    },
  })
}
