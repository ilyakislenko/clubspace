import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Абонементы → Платежи»: every sale (abonements and event tickets, any
// method) of a period, newest first, with the period's totals per method.
export type PaymentJournalPage = ApiTypes.ListPaymentJournalOutputOutput
export type PaymentJournalEntry = PaymentJournalPage["data"][number]
export type PaymentJournalTotals = PaymentJournalPage["totals"][number]
export type PaymentJournalMethodTotal = PaymentJournalTotals["byMethod"][number]
export type PaymentJournalUnappliedList = NonNullable<PaymentJournalPage["unapplied"]>
export type PaymentJournalUnapplied = PaymentJournalUnappliedList["data"][number]
export type PaymentJournalEntryDetail = ApiTypes.PaymentJournalEntryDetailOutputOutput
export type PaymentJournalQuery = NonNullable<ApiTypes.ListPaymentJournalData["query"]>
// CASH / TRANSFER / CARD / ONLINE, NONE = not recorded.
export type JournalMethod = NonNullable<PaymentJournalQuery["method"]>
// «Показывать»: payments and refunds (all), payments only, refunds only.
export type JournalKind = NonNullable<PaymentJournalQuery["kind"]>
export type OnlinePaymentStatus = NonNullable<PaymentJournalEntry["online"]>["status"]

// Money returned for one sale (`abonement` / `ticket`), or for an online
// payment that never became one (`unapplied`). CASH / TRANSFER / CARD only
// record it; ONLINE sends it back through the provider.
export type CreateRefundInput = ApiTypes.CreateRefundInput
export type CreateRefundResult = ApiTypes.CreateRefundOutputOutput
export type DeleteRefundResult = ApiTypes.DeleteRefundOutputOutput
export type RefundTarget = CreateRefundInput["target"]
export type RefundMethod = CreateRefundInput["method"]

// The journal's filters; the CSV export takes the same ones.
export type PaymentJournalFilters = Omit<PaymentJournalQuery, "curPage" | "perPage">

export const listPaymentJournal = async (
  params: { workspaceId: string } & PaymentJournalQuery,
): Promise<PaymentJournalPage> =>
  await getApiClient().request<PaymentJournalPage>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/payment-journal`,
    params: {
      from: params.from,
      to: params.to,
      method: params.method,
      kind: params.kind,
      markedById: params.markedById,
      discounted: params.discounted,
      discountId: params.discountId,
      pricedById: params.pricedById,
      gymId: params.gymId,
      directionId: params.directionId,
      groupId: params.groupId,
      coachId: params.coachId,
      q: params.q,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

// `entryId` is the row's id: `sub:<uuid>` / `reg:<uuid>` / `ref:<uuid>`.
export const getPaymentJournalEntry = async (params: {
  workspaceId: string
  entryId: string
}): Promise<PaymentJournalEntryDetail> =>
  await getApiClient().request<PaymentJournalEntryDetail>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/payment-journal/${encodeURIComponent(params.entryId)}`,
  })

export const createRefund = async (params: {
  workspaceId: string
  data: CreateRefundInput
}): Promise<CreateRefundResult> =>
  await getApiClient().request<CreateRefundResult, CreateRefundInput>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/refunds`,
    data: params.data,
  })

// Only an offline record (CASH / TRANSFER / CARD); an online refund is final.
export const deleteRefund = async (params: {
  workspaceId: string
  refundId: string
}): Promise<DeleteRefundResult> =>
  await getApiClient().request<DeleteRefundResult, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/refunds/${params.refundId}`,
  })
