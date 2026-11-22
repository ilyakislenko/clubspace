import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type SaleDiscounts = ApiTypes.ListSaleDiscountsOutputOutput
export type SaleDiscountOption = SaleDiscounts["options"][number]

// The club discounts staff may apply when selling to this member today, each
// priced by the server per tariff (or for `eventId`'s ticket). Options past
// their dates or limits for this member are left out; the family one is listed
// only when the member qualifies (the relative isn't named).
export const listSaleDiscounts = async (params: {
  workspaceId: string
  userId: string
  eventId?: string
}): Promise<SaleDiscounts> =>
  await getApiClient().request<SaleDiscounts>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/sale-discounts`,
    params: params.eventId ? { eventId: params.eventId } : undefined,
  })
