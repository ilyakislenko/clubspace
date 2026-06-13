import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type VideoTimestamp = ApiTypes.VideoTimestampOutputOutput
export type VideoSubtitleTrack = ApiTypes.VideoSubtitleOutputOutput
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

// Flat single-rung HLS media playlist (absolute presigned segment URLs) for
// offline download. Membership-checked server-side.
export const getOfflineManifest = async (params: { videoId: string }) => {
  return await getApiClient().request<ApiTypes.GetOfflineManifestOutputOutput>({
    method: "get",
    url: `/videos/${params.videoId}/offline-manifest`,
  })
}

export const setVideoFavorite = async (params: {
  videoId: string
  favorite: boolean
}) => {
  return await getApiClient().request<
    { videoId: string; favorite: boolean },
    { favorite: boolean }
  >({
    method: "put",
    url: `/videos/${params.videoId}/favorite`,
    data: { favorite: params.favorite },
  })
}

export type FavoriteEntry = {
  videoId: string
  createdAt: string
  video: {
    id: string
    title: string
    duration: number | null
    thumbnailUrl: string | null
    status: string
  } | null
}

export const listMyFavorites = async (params: { workspaceId: string }) => {
  return await getApiClient().request<{ data: FavoriteEntry[] }>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/me/favorites`,
  })
}
