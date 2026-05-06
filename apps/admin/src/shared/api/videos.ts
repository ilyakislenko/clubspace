import { getApiClient } from "./client"

export interface CreateVideoUploadPayload {
  workspaceId: string
  title: string
  description?: string
  contentType: string
}

export interface CreateVideoUploadResponse {
  videoId: string
  rawKey: string
  upload: {
    url: string
    method: "PUT"
  }
}

export type VideoTag = {
  id: string
  workspaceId: string
  type: string
  name: string
  slug: string
  description?: string | null
  createdAt: string
  updatedAt: string
}

export type VideoCategory = {
  id: string
  workspaceId: string
  name: string
  slug: string
  parentId?: string | null
  order: number
  createdAt: string
  updatedAt: string
}

export type VideoPlaylist = {
  id: string
  workspaceId: string
  title: string
  slug: string
  description?: string | null
  thumbnailUrl?: string | null
  status?: string | null
  accessLevel?: string | null
  level?: string | null
  lockedProgression: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export const createVideoUpload = async (
  payload: CreateVideoUploadPayload
): Promise<CreateVideoUploadResponse> => {
  return await getApiClient().request<CreateVideoUploadResponse, CreateVideoUploadPayload>(
    {
      method: "post",
      url: "/admin/videos",
      data: payload,
    }
  )
}

export const completeVideoUpload = async (params: {
  videoId: string
  workspaceId: string
}): Promise<{ status: "queued" }> => {
  return await getApiClient().request<{ status: "queued" }, { workspaceId: string }>(
    {
      method: "post",
      url: `/admin/videos/${params.videoId}/complete-upload`,
      data: { workspaceId: params.workspaceId },
    }
  )
}

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

export const getVideo = async (params: {
  videoId: string
  workspaceId: string
}) => {
  return await getApiClient().request<{
    id: string
    workspaceId: string
    title: string
    description?: string | null
    status: string
    isPublic: boolean
    url: string
    duration?: number | null
    thumbnailUrl?: string | null
    errorMessage?: string | null
    tags: VideoTag[]
    categories: VideoCategory[]
    playlists: VideoPlaylist[]
    timestamps: VideoTimestamp[]
    subtitles: VideoSubtitleTrack[]
    createdAt: string
    updatedAt: string
  }>({
    method: "get",
    url: `/admin/videos/${params.videoId}`,
    params: { workspaceId: params.workspaceId },
  })
}

export const createSubtitleUpload = async (params: {
  workspaceId: string
  videoId: string
  language: string
  contentType: "text/vtt" | "application/x-subrip"
}) => {
  return await getApiClient().request<
    {
      key: string
      publicUrl: string
      upload: { url: string; method: "PUT" }
    },
    { language: string; contentType: string }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/subtitles/upload-url`,
    data: { language: params.language, contentType: params.contentType },
  })
}

export const createSubtitle = async (params: {
  workspaceId: string
  videoId: string
  data: {
    language: string
    label: string
    storageKey: string
    publicUrl: string
    isDefault?: boolean
  }
}): Promise<VideoSubtitleTrack> => {
  return await getApiClient().request<
    VideoSubtitleTrack,
    typeof params.data
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/subtitles`,
    data: params.data,
  })
}

export const deleteSubtitle = async (params: {
  workspaceId: string
  videoId: string
  subtitleId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/subtitles/${params.subtitleId}`,
  })
}

export const createVideoTimestamp = async (params: {
  workspaceId: string
  videoId: string
  positionSec: number
  title: string
}): Promise<VideoTimestamp> => {
  return await getApiClient().request<
    VideoTimestamp,
    { positionSec: number; title: string }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/timestamps`,
    data: { positionSec: params.positionSec, title: params.title },
  })
}

export const updateVideoTimestamp = async (params: {
  workspaceId: string
  videoId: string
  timestampId: string
  data: { positionSec?: number; title?: string }
}): Promise<VideoTimestamp> => {
  return await getApiClient().request<
    VideoTimestamp,
    { positionSec?: number; title?: string }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/timestamps/${params.timestampId}`,
    data: params.data,
  })
}

export const deleteVideoTimestamp = async (params: {
  workspaceId: string
  videoId: string
  timestampId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/timestamps/${params.timestampId}`,
  })
}

export const listVideos = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
  q?: string
  tagId?: string
  categoryId?: string
}) => {
  return await getApiClient().request<{
    data: Array<{
      id: string
      workspaceId: string
      title: string
      description?: string | null
      status: string
      isPublic: boolean
      url: string
      duration?: number | null
      thumbnailUrl?: string | null
      errorMessage?: string | null
      tags: VideoTag[]
      categories: VideoCategory[]
      playlists: VideoPlaylist[]
      createdAt: string
      updatedAt: string
    }>
    total: number
    curPage: number
    perPage: number
  }>({
    method: "get",
    url: "/admin/videos",
    params: {
      workspaceId: params.workspaceId,
      curPage: params.curPage,
      perPage: params.perPage,
      q: params.q,
      tagId: params.tagId,
      categoryId: params.categoryId,
    },
  })
}

export const getVideoPlayback = async (params: { videoId: string }) => {
  return await getApiClient().request<{ hlsUrl: string }>({
    method: "get",
    url: `/videos/${params.videoId}/playback`,
  })
}

export const deleteVideo = async (params: {
  videoId: string
  workspaceId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/admin/videos/${params.videoId}`,
    params: { workspaceId: params.workspaceId },
  })
}

export const createVideoThumbnailUpload = async (params: {
  videoId: string
  workspaceId: string
  contentType: string
}) => {
  return await getApiClient().request<
    { key: string; publicUrl: string; upload: { url: string; method: "PUT" } },
    { workspaceId: string; contentType: string }
  >({
    method: "post",
    url: `/admin/videos/${params.videoId}/thumbnail-upload`,
    data: { workspaceId: params.workspaceId, contentType: params.contentType },
  })
}

export const updateVideo = async (params: {
  videoId: string
  workspaceId: string
  data: {
    title?: string
    description?: string | null
    thumbnailUrl?: string | null
    isPublic?: boolean
    tagIds?: string[]
    categoryIds?: string[]
    playlistIds?: string[]
    /** @deprecated use playlistIds instead. */
    playlistId?: string | null
  }
}) => {
  return await getApiClient().request<
    {
      id: string
      workspaceId: string
      title: string
      description?: string | null
      status: string
      isPublic: boolean
      url: string
      duration?: number | null
      thumbnailUrl?: string | null
      errorMessage?: string | null
      tags: VideoTag[]
      categories: VideoCategory[]
      playlists: VideoPlaylist[]
      createdAt: string
      updatedAt: string
    },
    {
      workspaceId: string
      title?: string
      description?: string | null
      thumbnailUrl?: string | null
      isPublic?: boolean
      tagIds?: string[]
      categoryIds?: string[]
      playlistIds?: string[]
      /** @deprecated use playlistIds instead. */
      playlistId?: string | null
    }
  >({
    method: "patch",
    url: `/admin/videos/${params.videoId}`,
    data: {
      workspaceId: params.workspaceId,
      ...params.data,
    },
  })
}
