import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Поиск по видео»: the club's videos this member may watch, searched by
// what's said (transcript and its Russian translation), chapter titles and
// video titles. Online only.

export type VideoSearchResult = ApiTypes.SearchVideosOutputOutput
export type VideoSearchItem = VideoSearchResult["items"][number]
export type VideoSearchMoment = VideoSearchItem["moments"][number]
export type VideoSearchHighlight = NonNullable<VideoSearchMoment["highlight"]>

export const searchVideos = async (params: { workspaceId: string; q: string }) => {
  return await getApiClient().request<VideoSearchResult>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/videos/search`,
    params: { q: params.q },
  })
}
