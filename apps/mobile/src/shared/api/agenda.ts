import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AgendaItem = ApiTypes.GetMyAgendaOutputOutput["items"][number]
export type AgendaKind = AgendaItem["kind"]

// Classes, events, guest visits and personal sessions across every club the
// member is in. `from`/`to` are inclusive YYYY-MM-DD (at most 14 days), read
// in each club's own zone.
export const fetchMyAgenda = async (params: { from: string; to: string }) => {
  return await getApiClient().request<ApiTypes.GetMyAgendaOutputOutput>({
    method: "get",
    url: "/me/agenda",
    params,
  })
}
