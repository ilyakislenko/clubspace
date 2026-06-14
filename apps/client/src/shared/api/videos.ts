import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type VideoDetail = ApiTypes.GetWorkspaceVideoOutputOutput

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
  return await getApiClient().request<ApiTypes.GetVideoPlaybackOutputOutput>({
    method: "get",
    url: `/videos/${params.videoId}/playback`,
  })
}

export const saveVideoProgress = async (params: {
  videoId: string
  position?: number
  completed?: boolean
  duration?: number
}) => {
  return await getApiClient().request<
    ApiTypes.SaveVideoProgressOutputOutput,
    { position?: number; completed?: boolean; duration?: number }
  >({
    method: "post",
    url: `/videos/${params.videoId}/progress`,
    data: {
      position: params.position,
      completed: params.completed,
      duration: params.duration,
    },
  })
}
