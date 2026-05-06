import { getApiClient } from "./client"

export type VideoTimestamp = {
  id: string
  positionSec: number
  title: string
}

export type VideoSubtitleTrack = {
  id: string
  language: string
  label: string
  publicUrl: string
  isDefault: boolean
}

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
  timestamps?: VideoTimestamp[]
  subtitles?: VideoSubtitleTrack[]
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
