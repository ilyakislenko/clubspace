import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type Direction = ApiTypes.ListDirectionsOutputOutput["data"][number]

// The short form tagged rows carry (groups, events, ladders, agenda items).
// `null` on a row means club-wide.
export type DirectionRef = Pick<Direction, "id" | "name" | "color" | "icon">

// The club's directions (БЖЖ, ММА, …) in display order. Students get only the
// active ones; `isMine` marks those the caller trains in or coaches. An empty
// list means the club doesn't use directions — every direction UI hides.
export const listDirections = async (params: {
  workspaceId: string
}): Promise<Direction[]> => {
  const response = await getApiClient().request<ApiTypes.ListDirectionsOutputOutput>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/directions`,
  })
  return response.data ?? []
}
