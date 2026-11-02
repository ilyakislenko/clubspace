import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// `provider` is null whenever `available` is false.
export type OnlinePurchaseOptions = ApiTypes.OnlinePurchaseOptionsOutputOutput
export type OnlinePlan = OnlinePurchaseOptions["plans"][number]
export type MyPayment = ApiTypes.MyPaymentOutputOutput
export type PaymentStatus = MyPayment["status"]
export type CreatePaymentInput = ApiTypes.CreatePaymentInput
export type CreatePaymentResult = ApiTypes.CreatePaymentOutputOutput

// What the «Оплатить онлайн» block shows: the club's online tariffs, why
// buying is impossible right now, and the member's latest still-pending
// payment. Open to a member whose access has expired.
export const getOnlinePurchaseOptions = async (params: {
  workspaceId: string
}): Promise<OnlinePurchaseOptions> =>
  await getApiClient().request<OnlinePurchaseOptions>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/online-purchase`,
  })

// Starts an online payment for a tariff; the app opens `confirmationUrl`, the
// provider's page. A repeated tap within a while returns the same payment.
// Never queued offline: the member must see a refusal now.
export const createPayment = async (params: {
  workspaceId: string
  data: CreatePaymentInput
}): Promise<CreatePaymentResult> =>
  await getApiClient().request<CreatePaymentResult, CreatePaymentInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/payments`,
    data: params.data,
  })

// One of the member's own payments. Stays PENDING until the provider's webhook
// lands (seconds after paying), then SUCCEEDED or CANCELED.
export const getMyPayment = async (params: {
  workspaceId: string
  paymentId: string
}): Promise<MyPayment> =>
  await getApiClient().request<MyPayment>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/payments/${params.paymentId}`,
  })
