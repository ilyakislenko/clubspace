import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// NB: `provider` is typed non-null by the generator but is null at runtime
// while `connected` is false — always guard with `connected` first.
export type PaymentSettings = ApiTypes.PaymentSettingsOutputOutput
export type PaymentSettingsInput = ApiTypes.UpdatePaymentSettingsInput
export type PaymentProvider = PaymentSettingsInput["provider"]
export type PaymentSubject = NonNullable<PaymentSettingsInput["paymentSubject"]>
export type PaymentMode = NonNullable<PaymentSettingsInput["paymentMode"]>
export type PaymentConnectionCheck = ApiTypes.CheckPaymentConnectionOutputOutput
export type PaymentsPage = ApiTypes.ListPaymentsOutputOutput
export type PaymentRow = PaymentsPage["data"][number]
export type PaymentStatus = PaymentRow["status"]
export type RefundResult = ApiTypes.RefundPaymentOutputOutput

const settingsUrl = (workspaceId: string) =>
  `/workspaces/${workspaceId}/payment-settings`

// ---- Provider settings ----

export const getPaymentSettings = async (params: {
  workspaceId: string
}): Promise<PaymentSettings> =>
  await getApiClient().request<PaymentSettings>({
    method: "get",
    url: settingsUrl(params.workspaceId),
  })

export const updatePaymentSettings = async (params: {
  workspaceId: string
  data: PaymentSettingsInput
}): Promise<PaymentSettings> =>
  await getApiClient().request<PaymentSettings, PaymentSettingsInput>({
    method: "put",
    url: settingsUrl(params.workspaceId),
    data: params.data,
  })

export const disconnectPayments = async (params: {
  workspaceId: string
}): Promise<PaymentSettings> =>
  await getApiClient().request<PaymentSettings, undefined>({
    method: "delete",
    url: settingsUrl(params.workspaceId),
  })

export const checkPaymentConnection = async (params: {
  workspaceId: string
}): Promise<PaymentConnectionCheck> =>
  await getApiClient().request<PaymentConnectionCheck, undefined>({
    method: "post",
    url: `${settingsUrl(params.workspaceId)}/check`,
  })

// ---- Payments ----

export const listPayments = async (params: {
  workspaceId: string
  status?: PaymentStatus
  page?: number
  perPage?: number
}): Promise<PaymentsPage> =>
  await getApiClient().request<PaymentsPage>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/payments`,
    params: {
      status: params.status,
      page: params.page,
      perPage: params.perPage,
    },
  })

export const refundPayment = async (params: {
  workspaceId: string
  paymentId: string
}): Promise<RefundResult> =>
  await getApiClient().request<RefundResult, undefined>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/payments/${params.paymentId}/refund`,
  })
