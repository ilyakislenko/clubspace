import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type PendingUsers = ApiTypes.ListPendingUsersOutputOutput
export type PendingUser = PendingUsers["data"][number]

// People who asked to join the club and wait for an admin's decision.
export const listPendingUsers = async (params: {
  workspaceId: string
}): Promise<PendingUsers> =>
  await getApiClient().request<PendingUsers>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/pending-users`,
  })

// Approving a request is the add-member call, by the request's user — a child
// profile has no e-mail to add by.
export const approvePendingMember = async (params: {
  workspaceId: string
  userId: string
}): Promise<ApiTypes.AddWorkspaceMemberOutputOutput> =>
  await getApiClient().request<
    ApiTypes.AddWorkspaceMemberOutputOutput,
    ApiTypes.AddWorkspaceMemberBody
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members`,
    data: { userId: params.userId },
  })

export const rejectPendingMember = async (params: {
  workspaceId: string
  userId: string
}): Promise<ApiTypes.RejectPendingMemberOutputOutput> =>
  await getApiClient().request<ApiTypes.RejectPendingMemberOutputOutput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/reject`,
  })
