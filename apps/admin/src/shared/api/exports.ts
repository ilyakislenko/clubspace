import { getApiClient } from "./client"

export type ExportKind = "members" | "renewals" | "attendance" | "revenue"

/**
 * Fetch a CSV export (authenticated) and trigger a browser download. The
 * endpoint returns text/csv, so axios keeps the body as a string. `from`/`to`
 * (YYYY-MM-DD) optionally bound attendance/revenue to a date range.
 */
export const downloadExport = async (params: {
  workspaceId: string
  kind: ExportKind
  from?: string
  to?: string
}): Promise<void> => {
  const csv = await getApiClient().request<string>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/exports/${params.kind}.csv`,
    params: {
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    },
  })

  const range =
    params.from || params.to
      ? `-${params.from ?? "_"}_${params.to ?? "_"}`
      : `-${new Date().toISOString().slice(0, 10)}`

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = `${params.kind}${range}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
