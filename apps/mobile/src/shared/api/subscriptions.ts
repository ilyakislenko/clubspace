import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MySubscription = ApiTypes.MySubscriptionOutputOutput
export type Subscription = MySubscription["history"][number]
// One of the member's current abonements (several may run at once, each with
// its own direction scope, freeze and freeze request).
export type MyAbonement = MySubscription["abonements"][number]
export type FreezeRequest = ApiTypes.SubscriptionFreezeRequestOutputOutput
export type FreezeRequestWindow = NonNullable<MyAbonement["freezeRequestWindow"]>
export type RequestFreezeInput = ApiTypes.RequestSubscriptionFreezeInput

// The current member's own abonement (current + history) and effective
// access window. Read-only — buying/renewing happens through the club.
export const getMySubscription = async (params: {
  workspaceId: string
}): Promise<MySubscription> =>
  await getApiClient().request<MySubscription>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/subscription`,
  })

// The member asks the coach to freeze one of their current abonements
// (`subscriptionId`). Never queued
// offline: the member must hear the refusal now.
export const requestSubscriptionFreeze = async (params: {
  workspaceId: string
  data: RequestFreezeInput
}): Promise<FreezeRequest> =>
  await getApiClient().request<FreezeRequest, RequestFreezeInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/me/subscription/freeze-requests`,
    data: params.data,
  })

export const cancelSubscriptionFreezeRequest = async (params: {
  workspaceId: string
  requestId: string
}): Promise<FreezeRequest> =>
  await getApiClient().request<FreezeRequest>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/me/subscription/freeze-requests/${params.requestId}/cancel`,
  })
