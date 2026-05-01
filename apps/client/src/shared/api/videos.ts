import { getApiClient } from "./client"

export type VideoDetail = {
  id: string
  workspaceId: string
  title: string
  description?: string | null
  status: string
  duration?: number | null
  thumbnailUrl?: string | null
  errorMessage?: string | null
  playlists: Array<{ id: string; title: string }>
}

export const getVideo = async (params: {
  workspaceId: string
  videoId: string
}) => {
  return await getApiClient().request<VideoDetail>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}`,
  })
}

export const getVideoPlayback = async (params: { videoId: string }) => {
  return await getApiClient().request<{ hlsUrl: string }>({
    method: "get",
    url: `/videos/${params.videoId}/playback`,
  })
}
