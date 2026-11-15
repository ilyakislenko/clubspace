import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// A member's autopay agreements (live + cancelled in the last 30 days), as the
// staff see them: amount and card are null for non-club-admins (server strip).
export type MemberAutopayList = ApiTypes.ListMemberAutopaysOutputOutput
export type MemberAutopay = MemberAutopayList["data"][number]
export type CancelMemberAutopayInput = ApiTypes.CancelMemberAutopayInput

const ws = (workspaceId: string) => `/workspaces/${workspaceId}`

export const listMemberAutopays = async (params: {
  workspaceId: string
  userId: string
}): Promise<MemberAutopayList> =>
  await getApiClient().request<MemberAutopayList>({
    method: "get",
    url: `${ws(params.workspaceId)}/members/${params.userId}/autopays`,
  })

// «Отключить автоплатёж» at the member's request (sport leads). Idempotent:
// an already cancelled agreement comes back as it is.
export const cancelMemberAutopay = async (params: {
  workspaceId: string
  autopayId: string
  data: CancelMemberAutopayInput
}): Promise<MemberAutopay> =>
  await getApiClient().request<MemberAutopay, CancelMemberAutopayInput>({
    method: "post",
    url: `${ws(params.workspaceId)}/autopays/${params.autopayId}/cancel`,
    data: params.data,
  })
