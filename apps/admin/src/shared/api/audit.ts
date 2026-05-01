import { getApiClient } from "./client"

export type AuditEvent = {
  id: string
  workspaceId: string | null
  actorId: string | null
  actorEmail: string | null
  action: string
  targetType: string
  targetId: string | null
  metadata: unknown
  createdAt: string
}

export const listAuditEvents = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
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
    },
  })
}
