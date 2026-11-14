import { getApiAxios } from "./client"
import type { PaymentJournalFilters } from "./payment-journal"

export type ExportKind = "members" | "renewals" | "attendance" | "payments"

// `attachment; filename="payments-2026-10-16_2026-11-15.csv"` → the name.
export const attachmentFileName = (disposition: string | undefined): string | null =>
  disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? null

/**
 * Fetch a CSV export (authenticated) and trigger a browser download under the
 * name the server gives it (Content-Disposition: the period's dates, the
 * default 30-day window included). `from`/`to` (YYYY-MM-DD) optionally bound
 * attendance/renewals/payments to a date range; payments also takes the rest
 * of the journal's filters (no dates = the journal's default 30 days).
 */
export const downloadExport = async (params: {
  workspaceId: string
  kind: ExportKind
  query?: PaymentJournalFilters
}): Promise<void> => {
  const query = Object.fromEntries(
    Object.entries(params.query ?? {}).filter(([, v]) => v !== undefined && v !== ""),
  )
  const response = await getApiAxios().get<string>(
    `/workspaces/${params.workspaceId}/exports/${params.kind}.csv`,
    { params: query, responseType: "text" },
  )
  const name =
    attachmentFileName(response.headers["content-disposition"]) ??
    `${params.kind}-${new Date().toISOString().slice(0, 10)}.csv`

  const blob = new Blob([response.data], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
