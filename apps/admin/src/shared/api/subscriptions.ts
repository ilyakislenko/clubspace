import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Plan = ApiTypes.PlanOutputDtoOutput
export type PlanInput = ApiTypes.CreatePlanInput
export type PlanUpdate = ApiTypes.UpdatePlanInput
export type MemberSubscriptions = ApiTypes.MemberSubscriptionsOutputOutput
export type Subscription = MemberSubscriptions["history"][number]
export type AssignInput = ApiTypes.AssignSubscriptionInput
export type AssignResult = ApiTypes.AssignSubscriptionOutputOutput
export type SubscriptionFreeze = MemberSubscriptions["freezes"][number]
export type FreezeInput = ApiTypes.FreezeSubscriptionInput
export type FreezeResult = ApiTypes.FreezeSubscriptionOutputOutput
export type EndFreezeResult = ApiTypes.EndSubscriptionFreezeOutputOutput
export type MarkPaidInput = ApiTypes.MarkSubscriptionPaidInput
export type MarkPaidResult = ApiTypes.MarkSubscriptionPaidOutputOutput
export type UnmarkPaidResult = ApiTypes.UnmarkSubscriptionPaidOutputOutput
export type AwaitingPaymentResult = ApiTypes.AwaitingPaymentOutputOutput
export type AwaitingPayment = ApiTypes.AwaitingPaymentOutputOutput["data"][number]

export type RenewalCandidate =
  ApiTypes.ListRenewalCandidatesOutputOutput["data"][number]

const ws = (workspaceId: string) => `/workspaces/${workspaceId}`

// ---- Renewal candidates (members to sell a new abonement to) ----

export const listRenewalCandidates = async (params: {
  workspaceId: string
}): Promise<{ data: RenewalCandidate[] }> =>
  await getApiClient().request<{ data: RenewalCandidate[] }>({
    method: "get",
    url: `${ws(params.workspaceId)}/renewal-candidates`,
  })

// ---- Abonements sold but not paid yet ----

export const listAwaitingPayment = async (params: {
  workspaceId: string
}): Promise<AwaitingPaymentResult> =>
  await getApiClient().request<AwaitingPaymentResult>({
    method: "get",
    url: `${ws(params.workspaceId)}/awaiting-payment`,
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
