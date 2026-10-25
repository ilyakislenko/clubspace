import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AtRiskList = ApiTypes.ListAtRiskMembersOutputOutput
export type AtRiskMember = AtRiskList["data"][number]
export type AtRiskReason = AtRiskMember["reason"]
export type AtRiskContact = ApiTypes.LogAtRiskContactOutputOutput
export type AtRiskContactInput = ApiTypes.LogAtRiskContactInput

export const listAtRiskMembers = async (params: {
  workspaceId: string
  scope?: "all" | "mine"
  gymId?: string
  groupId?: string
}): Promise<AtRiskList> =>
  await getApiClient().request<AtRiskList>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/at-risk-members`,
    params: {
      scope: params.scope,
      gymId: params.gymId,
      groupId: params.groupId,
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
