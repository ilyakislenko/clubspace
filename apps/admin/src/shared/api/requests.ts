import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead } from "./read-cache"

// «Ученики → Заявки»: what members asked the club for and the viewer may
// decide — join, freeze, personal session, video review — oldest first, with
// the per-kind counts of the viewer's whole scope (the filter never narrows
// them). The «Сегодня» row, the tab badge and the list read this one route.
export type OpenRequestsPage = ApiTypes.ListOpenRequestsOutputOutput
export type OpenRequest = OpenRequestsPage["data"][number]
export type RequestKind = OpenRequest["kind"]
export type RequestCounts = OpenRequestsPage["counts"]

export const listOpenRequests = async (params: {
  workspaceId: string
  kind?: RequestKind
  curPage?: number
  perPage?: number
}): Promise<OpenRequestsPage> =>
  await getApiClient().request<OpenRequestsPage>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/requests`,
    params: {
      kind: params.kind,
      curPage: params.curPage,
      perPage: params.perPage,
    },
  })

// Counts only (one row): the tab badge and «Сегодня» share the request while
// it is in flight; nothing is kept, since a `requests` signal reloads it.
export const getOpenRequestCounts = (params: {
  workspaceId: string
}): Promise<OpenRequestsPage> =>
  cachedRead(
    `requests:${params.workspaceId}`,
    () => listOpenRequests({ workspaceId: params.workspaceId, perPage: 1 }),
    0,
  )
