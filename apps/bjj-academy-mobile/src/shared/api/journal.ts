import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type Journal = ApiTypes.ListJournalOutputOutput
export type JournalEntry = Journal["entries"][number]

const base = (workspaceId: string) => `/workspaces/${workspaceId}/me/journal`

// The member's own training journal, newest first.
export const getMyJournal = async (params: {
  workspaceId: string
}): Promise<Journal> =>
  await getApiClient().request<Journal>({
    method: "get",
    url: base(params.workspaceId),
  })

export const createJournalEntry = async (params: {
  workspaceId: string
  body: string
  entryDate?: string
}): Promise<JournalEntry> =>
  await getApiClient().request<
    JournalEntry,
    { body: string; entryDate?: string }
  >({
    method: "post",
    url: base(params.workspaceId),
    data: {
      body: params.body,
      ...(params.entryDate ? { entryDate: params.entryDate } : {}),
    },
  })

export const deleteJournalEntry = async (params: {
  workspaceId: string
  entryId: string
}): Promise<{ status: "deleted" }> =>
  await getApiClient().request<{ status: "deleted" }>({
    method: "delete",
    url: `${base(params.workspaceId)}/${params.entryId}`,
  })
