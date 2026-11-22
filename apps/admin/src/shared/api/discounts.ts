import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Абонементы → Скидки» (club admins): the club's discounts — chosen by staff
// at a sale, entered as a promo code in the app, or the automatic family one —
// and who gave how much off the list price in a period.
export type DiscountList = ApiTypes.ListDiscountsOutputOutput
export type Discount = ApiTypes.DiscountOutputOutput
export type DiscountStaffSummary = DiscountList["byStaff"][number]
export type DiscountInput = ApiTypes.CreateDiscountInput
export type DiscountUpdate = ApiTypes.UpdateDiscountInput
export type DiscountKind = Discount["kind"]

// The discounts a seller may apply to one member now, each priced by the
// server per tariff (or for one event's ticket).
export type SaleDiscounts = ApiTypes.ListSaleDiscountsOutputOutput
export type SaleDiscountOption = SaleDiscounts["options"][number]

export const listDiscounts = async (params: {
  workspaceId: string
  // With the archived ones too.
  archived?: boolean
  // Club-local days of the «Кто давал скидки» summary; neither = 30 days.
  from?: string
  to?: string
}): Promise<DiscountList> =>
  await getApiClient().request<DiscountList>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/discounts`,
    params: {
      archived: params.archived ? true : undefined,
      from: params.from,
      to: params.to,
    },
  })

export const createDiscount = async (params: {
  workspaceId: string
  data: DiscountInput
}): Promise<Discount> =>
  await getApiClient().request<Discount, DiscountInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/discounts`,
    data: params.data,
  })

// Also «В архив» / «Вернуть из архива» (`isActive`).
export const updateDiscount = async (params: {
  workspaceId: string
  discountId: string
  data: DiscountUpdate
}): Promise<Discount> =>
  await getApiClient().request<Discount, DiscountUpdate>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/discounts/${params.discountId}`,
    data: params.data,
  })

// Only one nobody has used yet; a used one goes to the archive.
export const deleteDiscount = async (params: {
  workspaceId: string
  discountId: string
}): Promise<ApiTypes.DeleteDiscountOutputOutput> =>
  await getApiClient().request<ApiTypes.DeleteDiscountOutputOutput, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/discounts/${params.discountId}`,
  })

// The sale and mark-paid forms: tariffs without `eventId`, that event's
// ticket with it.
export const listSaleDiscounts = async (params: {
  workspaceId: string
  userId: string
  eventId?: string
}): Promise<SaleDiscounts> =>
  await getApiClient().request<SaleDiscounts>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/members/${params.userId}/sale-discounts`,
    params: { eventId: params.eventId },
  })
