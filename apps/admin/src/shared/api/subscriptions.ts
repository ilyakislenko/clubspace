import type { ApiTypes } from "@clubspace/api-client"

import type { AnalyticsScope } from "./analytics"
import { getApiClient } from "./client"

export type Plan = ApiTypes.PlanOutputDtoOutput
export type PlanInput = ApiTypes.CreatePlanInput
export type PlanUpdate = ApiTypes.UpdatePlanInput
export type MemberSubscriptions = ApiTypes.MemberSubscriptionsOutputOutput
export type MemberAbonement = MemberSubscriptions["abonements"][number]
export type Subscription = MemberSubscriptions["history"][number]
export type AssignInput = ApiTypes.AssignSubscriptionInput
export type AssignResult = ApiTypes.AssignSubscriptionOutputOutput
export type SubscriptionFreeze = MemberSubscriptions["freezes"][number]
export type FreezeInput = ApiTypes.FreezeSubscriptionInput
export type FreezeResult = ApiTypes.FreezeSubscriptionOutputOutput
export type EndFreezeResult = ApiTypes.EndSubscriptionFreezeOutputOutput
export type FreezeRequest = NonNullable<MemberAbonement["freezeRequest"]>
export type ApproveFreezeRequestInput =
  ApiTypes.ApproveSubscriptionFreezeRequestInput
export type ApproveFreezeRequestResult =
  ApiTypes.ApproveSubscriptionFreezeRequestOutputOutput
export type DeclineFreezeRequestInput =
  ApiTypes.DeclineSubscriptionFreezeRequestInput
export type DeclineFreezeRequestResult = ApiTypes.DecidedFreezeRequestOutputOutput
export type MarkPaidInput = ApiTypes.MarkSubscriptionPaidInput
export type MarkPaidResult = ApiTypes.MarkSubscriptionPaidOutputOutput
export type UnmarkPaidResult = ApiTypes.UnmarkSubscriptionPaidOutputOutput
export type AwaitingPaymentResult = ApiTypes.AwaitingPaymentOutputOutput
export type AwaitingPayment = ApiTypes.AwaitingPaymentOutputOutput["data"][number]

export type RenewalCandidateList = ApiTypes.ListRenewalCandidatesOutputOutput
export type RenewalCandidate = RenewalCandidateList["data"][number]

const ws = (workspaceId: string) => `/workspaces/${workspaceId}`

type ListPage = { curPage?: number; perPage?: number } & AnalyticsScope

// ---- «Продлить» (members due for renewal), one page ----

export const listRenewalCandidates = async (
  params: { workspaceId: string } & ListPage,
): Promise<RenewalCandidateList> =>
  await getApiClient().request<RenewalCandidateList>({
    method: "get",
    url: `${ws(params.workspaceId)}/renewal-candidates`,
    params: {
      gymId: params.gymId,
      directionId: params.directionId,
      groupId: params.groupId,
      coachId: params.coachId,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

// ---- Abonements sold but not paid yet, one page ----

export const listAwaitingPayment = async (
  params: { workspaceId: string } & ListPage,
): Promise<AwaitingPaymentResult> =>
  await getApiClient().request<AwaitingPaymentResult>({
    method: "get",
    url: `${ws(params.workspaceId)}/awaiting-payment`,
    params: {
      gymId: params.gymId,
      directionId: params.directionId,
      groupId: params.groupId,
      coachId: params.coachId,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

// ---- Tariffs (Plans) ----

export const listPlans = async (params: {
  workspaceId: string
  includeInactive?: boolean
}): Promise<{ data: Plan[] }> =>
  await getApiClient().request<{ data: Plan[] }>({
    method: "get",
    url: `${ws(params.workspaceId)}/plans`,
    params: { includeInactive: params.includeInactive },
  })

// The tariff page: the tariff, who holds it now, the last 30 days of sales.
export type PlanDetails = ApiTypes.GetPlanOutputOutput
export type PlanHolder = PlanDetails["holders"][number]

export const getPlan = async (params: {
  workspaceId: string
  planId: string
}): Promise<PlanDetails> =>
  await getApiClient().request<PlanDetails>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/plans/${params.planId}`,
  })

export const createPlan = async (params: {
  workspaceId: string
  data: PlanInput
}): Promise<Plan> =>
  await getApiClient().request<Plan, PlanInput>({
    method: "post",
    url: `${ws(params.workspaceId)}/plans`,
    data: params.data,
  })

export const updatePlan = async (params: {
  workspaceId: string
  planId: string
  data: PlanUpdate
}): Promise<Plan> =>
  await getApiClient().request<Plan, PlanUpdate>({
    method: "patch",
    url: `${ws(params.workspaceId)}/plans/${params.planId}`,
    data: params.data,
  })

export const deletePlan = async (params: {
  workspaceId: string
  planId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `${ws(params.workspaceId)}/plans/${params.planId}`,
  })

// ---- Member abonements (Subscriptions) ----

export const assignSubscription = async (params: {
  workspaceId: string
  userId: string
  data: AssignInput
}): Promise<AssignResult> =>
  await getApiClient().request<AssignResult, AssignInput>({
    method: "post",
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscription`,
    data: params.data,
  })

export const listMemberSubscriptions = async (params: {
  workspaceId: string
  userId: string
}): Promise<MemberSubscriptions> =>
  await getApiClient().request<MemberSubscriptions>({
    method: "get",
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscriptions`,
  })

export const cancelSubscription = async (params: {
  workspaceId: string
  userId: string
  subscriptionId: string
}): Promise<Subscription> =>
  await getApiClient().request<Subscription>({
    method: "post",
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscriptions/${params.subscriptionId}/cancel`,
  })

export const freezeSubscription = async (params: {
  workspaceId: string
  userId: string
  subscriptionId: string
  data: FreezeInput
}): Promise<FreezeResult> =>
  await getApiClient().request<FreezeResult, FreezeInput>({
    method: "post",
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscriptions/${params.subscriptionId}/freezes`,
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
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscriptions/${params.subscriptionId}/freezes/${params.freezeId}/end`,
  })

// Members' freeze requests waiting for a decision — those the caller may
// decide (a coach: members of their groups), the oldest 100 and the total.
export type PendingFreezeRequests = ApiTypes.PendingFreezeRequestsOutputOutput
export type PendingFreezeRequest = PendingFreezeRequests["data"][number]

export const listPendingFreezeRequests = async (params: {
  workspaceId: string
}): Promise<PendingFreezeRequests> =>
  await getApiClient().request<PendingFreezeRequests>({
    method: "get",
    url: `${ws(params.workspaceId)}/freeze-requests`,
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
    url: `${ws(params.workspaceId)}/freeze-requests/${params.requestId}/approve`,
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
    url: `${ws(params.workspaceId)}/freeze-requests/${params.requestId}/decline`,
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
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscriptions/${params.subscriptionId}/payment`,
    data: params.data,
  })

export const unmarkSubscriptionPaid = async (params: {
  workspaceId: string
  userId: string
  subscriptionId: string
}): Promise<UnmarkPaidResult> =>
  await getApiClient().request<UnmarkPaidResult>({
    method: "delete",
    url: `${ws(params.workspaceId)}/members/${params.userId}/subscriptions/${params.subscriptionId}/payment`,
  })
