import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type MyAutopay = ApiTypes.MyAutopayOutputOutput
export type AcceptMyAutopayTermsInput = ApiTypes.AcceptMyAutopayTermsInput

// The member's autopay agreements: live ones plus those cancelled in the last
// 30 days (the written confirmation stays visible). Open to a member whose
// access has expired — a refusal is never blocked.
export const listMyAutopays = async (params: {
  workspaceId: string
}): Promise<MyAutopay[]> =>
  (
    await getApiClient().request<ApiTypes.ListMyAutopaysOutputOutput>({
      method: "get",
      url: `/workspaces/${params.workspaceId}/me/autopays`,
    })
  ).data

// Stops future charges at once; the current abonement is untouched. Repeating
// it on a cancelled agreement returns it as is. Never queued offline: the
// member must see the refusal go through.
export const cancelMyAutopay = async (params: {
  workspaceId: string
  autopayId: string
}): Promise<MyAutopay> =>
  await getApiClient().request<MyAutopay>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/me/autopays/${params.autopayId}/cancel`,
  })

// Agrees to the tariff's new terms, echoing what the screen showed; the server
// answers 409 when they changed again meanwhile.
export const acceptMyAutopayTerms = async (params: {
  workspaceId: string
  autopayId: string
  data: AcceptMyAutopayTermsInput
}): Promise<MyAutopay> =>
  await getApiClient().request<MyAutopay, AcceptMyAutopayTermsInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/me/autopays/${params.autopayId}/accept-terms`,
    data: params.data,
  })
