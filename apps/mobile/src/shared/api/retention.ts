import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AtRiskList = ApiTypes.ListAtRiskMembersOutputOutput
export type AtRiskMember = AtRiskList["data"][number]
export type AtRiskSummary = AtRiskList["summary"]
export type AtRiskReason = AtRiskMember["reason"]
export type AtRiskContact = ApiTypes.LogAtRiskContactOutputOutput
export type AtRiskContactInput = ApiTypes.LogAtRiskContactInput

// «Кому позвонить» — the same list as the admin page and the dashboard: the
// server scopes it to the caller (a coach: their own groups). The summary
// counts ignore `reason` and the page; `snoozed` lists the contacted ones.
export const listAtRiskMembers = async (params: {
  workspaceId: string
  reason?: AtRiskReason
  snoozed?: boolean
  curPage?: number
  perPage?: number
}): Promise<AtRiskList> =>
  await getApiClient().request<AtRiskList>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/at-risk-members`,
    params: {
      reason: params.reason,
      snoozed: params.snoozed,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

export const logAtRiskContact = async (params: {
  workspaceId: string
  userId: string
  note: string | null
}): Promise<AtRiskContact> =>
  await getApiClient().request<AtRiskContact, AtRiskContactInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/at-risk-members/${params.userId}/contacts`,
    data: { note: params.note },
  })
