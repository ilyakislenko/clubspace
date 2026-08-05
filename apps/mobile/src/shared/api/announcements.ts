import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type AnnouncementFeed = ApiTypes.AnnouncementFeedOutputOutput
export type Announcement = AnnouncementFeed["data"][number]

// The workspace's published announcement feed (pinned first, then newest).
// Any member can read it; posting/editing stays behind the admin panel.
export const getAnnouncementFeed = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
}): Promise<AnnouncementFeed> => {
  const search = new URLSearchParams()
  if (params.curPage) search.set("curPage", String(params.curPage))
  if (params.perPage) search.set("perPage", String(params.perPage))
  const qs = search.toString()
  return await getApiClient().request<AnnouncementFeed>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/announcements/feed${qs ? `?${qs}` : ""}`,
  })
}
