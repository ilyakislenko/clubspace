import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MemberSubscriptions = ApiTypes.MemberSubscriptionsOutputOutput
export type MemberSubscription = MemberSubscriptions["history"][number]
export type MemberSubscriptionFreeze = MemberSubscriptions["freezes"][number]
export type Plan = ApiTypes.PlanOutputDtoOutput
export type AssignInput = ApiTypes.AssignSubscriptionInput
export type AssignResult = ApiTypes.AssignSubscriptionOutputOutput
export type MarkPaidInput = ApiTypes.MarkSubscriptionPaidInput
export type MarkPaidResult = ApiTypes.MarkSubscriptionPaidOutputOutput
export type FreezeInput = ApiTypes.FreezeSubscriptionInput
export type FreezeResult = ApiTypes.FreezeSubscriptionOutputOutput
export type EndFreezeResult = ApiTypes.EndSubscriptionFreezeOutputOutput
export type PendingFreezeRequests = ApiTypes.PendingFreezeRequestsOutputOutput
export type PendingFreezeRequest = PendingFreezeRequests["data"][number]
export type MemberFreezeRequest = NonNullable<MemberSubscriptions["freezeRequest"]>
export type ApproveFreezeRequestInput =
  ApiTypes.ApproveSubscriptionFreezeRequestInput
export type ApproveFreezeRequestResult =
  ApiTypes.ApproveSubscriptionFreezeRequestOutputOutput
export type DeclineFreezeRequestInput =
  ApiTypes.DeclineSubscriptionFreezeRequestInput
export type DeclineFreezeRequestResult = ApiTypes.DecidedFreezeRequestOutputOutput

const member = (workspaceId: string, userId: string) =>
  `/workspaces/${workspaceId}/members/${userId}`

// A student's abonements as the coach sees them, with what the caller may do
// (`permissions`): a coach manages members of their own groups only.
export const listMemberSubscriptions = async (params: {
  workspaceId: string
  userId: string
}): Promise<MemberSubscriptions> =>
  await getApiClient().request<MemberSubscriptions>({
    method: "get",
    url: `${member(params.workspaceId, params.userId)}/subscriptions`,
  })

// Sellable (active) tariffs of the club.
export const listPlans = async (params: {
  workspaceId: string
}): Promise<{ data: Plan[] }> =>
  await getApiClient().request<{ data: Plan[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/plans`,
  })

export const assignSubscription = async (params: {
  workspaceId: string
  userId: string
  data: AssignInput
}): Promise<AssignResult> =>
  await getApiClient().request<AssignResult, AssignInput>({
    method: "post",
    url: `${member(params.workspaceId, params.userId)}/subscription`,
    data: params.data,
  })

export const markSubscriptionPaid = async (params: {
  workspaceId: string
  userId: string
  subscriptionId: string
  data: MarkPaidInput
}): Promise<MarkPaidResult> =>
  await getApiClient().request<MarkPaidResult, MarkPaidInput>({
    method: "post",
    url: `${member(params.workspaceId, params.userId)}/subscriptions/${params.subscriptionId}/payment`,
    data: params.data,
  })

export const freezeSubscription = async (params: {
  workspaceId: string
  userId: string
  subscriptionId: string
  data: FreezeInput
}): Promise<FreezeResult> =>
  await getApiClient().request<FreezeResult, FreezeInput>({
    method: "post",
    url: `${member(params.workspaceId, params.userId)}/subscriptions/${params.subscriptionId}/freezes`,
    data: params.data,
  })

export const endSubscriptionFreeze = async (params: {
  workspaceId: string
  userId: string
  subscriptionId: string
  freezeId: string
}): Promise<EndFreezeResult> =>
  await getApiClient().request<EndFreezeResult>({
    method: "post",
    url: `${member(params.workspaceId, params.userId)}/subscriptions/${params.subscriptionId}/freezes/${params.freezeId}/end`,
  })

// The staff queue of members' freeze requests (a coach sees their own groups').
export const listPendingFreezeRequests = async (params: {
  workspaceId: string
}): Promise<PendingFreezeRequests> =>
  await getApiClient().request<PendingFreezeRequests>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/freeze-requests`,
  })

export const approveSubscriptionFreezeRequest = async (params: {
  workspaceId: string
  requestId: string
  data: ApproveFreezeRequestInput
}): Promise<ApproveFreezeRequestResult> =>
  await getApiClient().request<
    ApproveFreezeRequestResult,
    ApproveFreezeRequestInput
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/freeze-requests/${params.requestId}/approve`,
    data: params.data,
  })

export const declineSubscriptionFreezeRequest = async (params: {
  workspaceId: string
  requestId: string
  data: DeclineFreezeRequestInput
}): Promise<DeclineFreezeRequestResult> =>
  await getApiClient().request<
    DeclineFreezeRequestResult,
    DeclineFreezeRequestInput
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/freeze-requests/${params.requestId}/decline`,
    data: params.data,
  })
