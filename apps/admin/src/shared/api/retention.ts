import type { ApiTypes } from "@clubspace/api-client"

import type { AnalyticsScope } from "./analytics"
import { getApiClient } from "./client"

export type AtRiskList = ApiTypes.ListAtRiskMembersOutputOutput
export type AtRiskMember = AtRiskList["data"][number]
export type AtRiskReason = AtRiskMember["reason"]
export type AtRiskLevel = NonNullable<AtRiskMember["level"]>
export type AtRiskContact = ApiTypes.LogAtRiskContactOutputOutput
export type AtRiskContactInput = ApiTypes.LogAtRiskContactInput

// «Кому позвонить». The server scopes it to the caller (a coach: own groups);
// the summary counts ignore `reason` and the page.
export const listAtRiskMembers = async (
  params: {
    workspaceId: string
    reason?: AtRiskReason
    snoozed?: boolean
    curPage?: number
    perPage?: number
  } & AnalyticsScope,
): Promise<AtRiskList> =>
  await getApiClient().request<AtRiskList>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/at-risk-members`,
    params: {
      gymId: params.gymId,
      directionId: params.directionId,
      groupId: params.groupId,
      coachId: params.coachId,
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
