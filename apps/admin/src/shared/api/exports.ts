import { getApiClient } from "./client"

export type ExportKind = "members" | "attendance" | "revenue"

/**
 * Fetch a CSV export (authenticated) and trigger a browser download. The
 * endpoint returns text/csv, so axios keeps the body as a string.
 */
export const downloadExport = async (params: {
  workspaceId: string
  kind: ExportKind
}): Promise<void> => {
  const csv = await getApiClient().request<string>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/exports/${params.kind}.csv`,
  })

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = `${params.kind}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
