import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type CreateVideoUploadPayload = ApiTypes.CreateVideoUploadInput

export type CreateVideoUploadResponse = ApiTypes.CreateVideoUploadOutputOutput

export type VideoUploadTarget = CreateVideoUploadResponse["upload"]

export type CompletedUploadPart = NonNullable<
  ApiTypes.CompleteVideoUploadInput["parts"]
>[number]

export type VideoTag = ApiTypes.ListTagsOutputOutput["data"][number]

export type VideoCategory = ApiTypes.ListCategoriesOutputOutput["data"][number]

export type VideoPlaylist = ApiTypes.GetVideoOutputOutput["playlists"][number]

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

// `parts`: the ETags of a multipart upload (create returned MULTIPART).
export const completeVideoUpload = async (params: {
  videoId: string
  workspaceId: string
  parts?: CompletedUploadPart[]
}): Promise<ApiTypes.CompleteVideoUploadOutputOutput> => {
  return await getApiClient().request<
    ApiTypes.CompleteVideoUploadOutputOutput,
    ApiTypes.CompleteVideoUploadInput
  >({
    method: "post",
    url: `/admin/videos/${params.videoId}/complete-upload`,
    data: { workspaceId: params.workspaceId, parts: params.parts },
  })
}

// Drops an upload that was cancelled or failed before transcoding: the parts
// already in storage and the video row.
export const abortVideoUpload = async (params: {
  videoId: string
  workspaceId: string
}): Promise<ApiTypes.AbortVideoUploadOutputOutput> => {
  return await getApiClient().request<
    ApiTypes.AbortVideoUploadOutputOutput,
    ApiTypes.AbortVideoUploadInput
  >({
    method: "post",
    url: `/admin/videos/${params.videoId}/abort-upload`,
    data: { workspaceId: params.workspaceId },
  })
}

export type VideoTimestamp = ApiTypes.VideoTimestampOutputOutput

export type VideoSubtitleTrack = ApiTypes.VideoSubtitleOutputOutput

export const getVideo = async (params: {
  videoId: string
  workspaceId: string
}) => {
  return await getApiClient().request<ApiTypes.GetVideoOutputOutput>({
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

export const updateVideoTimestamp = async (params: {
  workspaceId: string
  videoId: string
  timestampId: string
  data: ApiTypes.UpdateVideoTimestampInput
}): Promise<VideoTimestamp> => {
  return await getApiClient().request<
    VideoTimestamp,
    ApiTypes.UpdateVideoTimestampInput
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/timestamps/${params.timestampId}`,
    data: params.data,
  })
}

// «Главы и субтитры»: what the worker made from the lesson (transcript,
// automatic chapters and subtitles) and «Пересоздать».
export type VideoTextStatus = ApiTypes.VideoTextStatusOutputOutput
export type RegenerateVideoTextInput = ApiTypes.RegenerateVideoTextInput
export type SubtitleCues = ApiTypes.SubtitleCuesOutputOutput

export const getVideoTextStatus = async (params: {
  workspaceId: string
  videoId: string
}): Promise<VideoTextStatus> => {
  return await getApiClient().request<VideoTextStatus>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/text-status`,
  })
}

export const regenerateVideoText = async (params: {
  workspaceId: string
  videoId: string
  data: RegenerateVideoTextInput
}): Promise<ApiTypes.RegenerateVideoTextOutputOutput> => {
  return await getApiClient().request<
    ApiTypes.RegenerateVideoTextOutputOutput,
    RegenerateVideoTextInput
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/regenerate-text`,
    data: params.data,
  })
}

export const getSubtitleCues = async (params: {
  workspaceId: string
  videoId: string
  subtitleId: string
}): Promise<SubtitleCues> => {
  return await getApiClient().request<SubtitleCues>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/videos/${params.videoId}/subtitles/${params.subtitleId}/cues`,
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

export type BulkVideoAction =
  | "setPublic"
  | "setPrivate"
  | "addCategory"
  | "removeCategory"
  | "delete"

export const bulkUpdateVideos = async (params: {
  workspaceId: string
  videoIds: string[]
  action: BulkVideoAction
  categoryId?: string
}): Promise<{ affected: number }> => {
  return await getApiClient().request<
    { affected: number },
    {
      workspaceId: string
      videoIds: string[]
      action: BulkVideoAction
      categoryId?: string
    }
  >({
    method: "post",
    url: "/admin/videos/bulk",
    data: {
      workspaceId: params.workspaceId,
      videoIds: params.videoIds,
      action: params.action,
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
