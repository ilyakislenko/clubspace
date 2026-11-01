import { Platform } from "react-native"

import type { ApiTypes } from "@clubspace/api-client"

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

// The URI to feed the player. Native streams HLS; browsers (except Safari)
// can't play an HLS .m3u8 in a <video>, so on web we hand back the progressive
// MP4 (the raw upload) instead, which plays everywhere. Its own link, signed
// for the lesson's length — the offline-download one expires in 30 minutes.
export const getStreamingUri = async (params: {
  videoId: string
}): Promise<string> => {
  if (Platform.OS === "web") {
    const { url } = await getWebPlayback(params)
    return url
  }
  const { hlsUrl } = await getVideoPlayback(params)
  return hlsUrl
}

export const getWebPlayback = async (params: { videoId: string }) => {
  return await getApiClient().request<ApiTypes.GetWebPlaybackOutputOutput>({
    method: "get",
    url: `/videos/${params.videoId}/web-playback`,
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

// Presigned progressive-MP4 URL for offline download — a single file that plays
// from file:// on iOS and Android (unlike the HLS manifest).
export const getOfflineDownload = async (params: { videoId: string }) => {
  return await getApiClient().request<ApiTypes.GetOfflineDownloadOutputOutput>({
    method: "get",
    url: `/videos/${params.videoId}/offline-download`,
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
