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
export type OnlinePaymentStatus = NonNullable<PaymentJournalEntry["online"]>["status"]

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
      gymId: params.gymId,
      directionId: params.directionId,
      groupId: params.groupId,
      coachId: params.coachId,
      q: params.q,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

// `entryId` is the row's id: `sub:<uuid>` / `reg:<uuid>`.
export const getPaymentJournalEntry = async (params: {
  workspaceId: string
  entryId: string
}): Promise<PaymentJournalEntryDetail> =>
  await getApiClient().request<PaymentJournalEntryDetail>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/payment-journal/${encodeURIComponent(params.entryId)}`,
  })
