import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// `provider` is null while `connected` is false.
export type PaymentSettings = ApiTypes.PaymentSettingsOutputOutput
export type PaymentSettingsInput = ApiTypes.UpdatePaymentSettingsInput
export type PaymentProvider = PaymentSettingsInput["provider"]
export type PaymentSubject = NonNullable<PaymentSettingsInput["paymentSubject"]>
export type PaymentMode = NonNullable<PaymentSettingsInput["paymentMode"]>
export type PaymentConnectionCheck = ApiTypes.CheckPaymentConnectionOutputOutput

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
