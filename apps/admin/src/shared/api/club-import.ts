import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type ClubImport = ApiTypes.GetClubImportOutputOutput
export type ClubImportMapping = ClubImport["mapping"]
export type ClubImportRow = ApiTypes.ListClubImportRowsOutputOutput["data"][number]
export type ClubImportRowAction = ClubImportRow["action"]

const base = (workspaceId: string) => `/workspaces/${workspaceId}/club-imports`

// The raw file goes up as multipart: the server detects the encoding
// (UTF-8 / Windows-1251) from the bytes.
export const uploadClubImport = async (p: { workspaceId: string; file: Blob; fileName: string }) => {
  const form = new FormData()
  form.append("file", p.file, p.fileName)
  return await getApiClient().request<ClubImport, FormData>({
    method: "post",
    url: base(p.workspaceId),
    data: form,
  })
}

export const getClubImport = async (p: { workspaceId: string; importId: string }) =>
  await getApiClient().request<ClubImport>({
    method: "get",
    url: `${base(p.workspaceId)}/${p.importId}`,
  })

export const previewClubImport = async (p: {
  workspaceId: string
  importId: string
  mapping: ClubImportMapping
  createMissing: boolean
  overwrite: boolean
}) =>
  await getApiClient().request<ClubImport, ApiTypes.PreviewClubImportBody>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.importId}/preview`,
    data: { mapping: p.mapping, createMissing: p.createMissing, overwrite: p.overwrite },
  })

export const applyClubImport = async (p: { workspaceId: string; importId: string }) =>
  await getApiClient().request<ClubImport>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.importId}/apply`,
  })

export const listClubImportRows = async (p: {
  workspaceId: string
  importId: string
  action?: ClubImportRowAction
  withMessages?: boolean
  offset: number
  limit: number
}) =>
  await getApiClient().request<ApiTypes.ListClubImportRowsOutputOutput>({
    method: "get",
    url: `${base(p.workspaceId)}/${p.importId}/rows`,
    params: {
      ...(p.action ? { action: p.action } : {}),
      ...(p.withMessages ? { withMessages: "true" } : {}),
      offset: p.offset,
      limit: p.limit,
    },
  })

// The CSV template (Russian headers, two example rows) as a download.
export const downloadClubImportTemplate = async (p: { workspaceId: string }) => {
  const csv = await getApiClient().request<string>({
    method: "get",
    url: `${base(p.workspaceId)}/template.csv`,
  })
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  try {
    const a = document.createElement("a")
    a.href = url
    a.download = "shablon-importa-kluba.csv"
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}
