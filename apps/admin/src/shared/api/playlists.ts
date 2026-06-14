import type { ApiTypes } from "@bjj-academy/api-client"

import { getApiClient } from "./client"

export type PlaylistPayload = ApiTypes.CreatePlaylistInput

export type PlaylistResponse = ApiTypes.CreatePlaylistOutputOutput

export const createPlaylist = async (params: {
  workspaceId: string
  data: PlaylistPayload
}): Promise<PlaylistResponse> => {
  return await getApiClient().request<PlaylistResponse, PlaylistPayload>({
    method: "post",
    url: `/workspaces/${params.workspaceId}/playlists`,
    data: params.data,
  })
}

export const updatePlaylist = async (params: {
  workspaceId: string
  playlistId: string
  data: Partial<PlaylistPayload>
}): Promise<PlaylistResponse> => {
  return await getApiClient().request<PlaylistResponse, Partial<PlaylistPayload>>({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}`,
    data: params.data,
  })
}

export const deletePlaylist = async (params: {
  workspaceId: string
  playlistId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}`,
  })
}

export const createPlaylistThumbnailUpload = async (params: {
  workspaceId: string
  playlistId: string
  contentType: string
}) => {
  return await getApiClient().request<
    { key: string; publicUrl: string; upload: { url: string; method: "PUT" } },
    { contentType: string }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/thumbnail-upload`,
    data: { contentType: params.contentType },
  })
}

export type CoursePlaylistDetail = ApiTypes.GetPlaylistOutputOutput

export type CoursePlaylistVideo = CoursePlaylistDetail["videos"][number]

export type CoursePlaylistChapter = CoursePlaylistDetail["chapters"][number]

export const getPlaylist = async (params: {
  workspaceId: string
  playlistId: string
}): Promise<CoursePlaylistDetail> => {
  return await getApiClient().request<CoursePlaylistDetail, undefined>({
    method: "get",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}`,
  })
}

export const attachVideosToPlaylist = async (params: {
  workspaceId: string
  playlistId: string
  videoIds: string[]
}) => {
  return await getApiClient().request<
    { added: number; skipped: number },
    { videoIds: string[] }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/videos`,
    data: { videoIds: params.videoIds },
  })
}

export const detachVideoFromPlaylist = async (params: {
  workspaceId: string
  playlistId: string
  videoId: string
}) => {
  return await getApiClient().request<{ status: "removed" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/videos/${params.videoId}`,
  })
}

export const updatePlaylistVideo = async (params: {
  workspaceId: string
  playlistId: string
  videoId: string
  data: { chapterId?: string | null }
}) => {
  return await getApiClient().request<
    { videoId: string; chapterId: string | null; order: number },
    { chapterId?: string | null }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/videos/${params.videoId}`,
    data: params.data,
  })
}

export const createPlaylistChapter = async (params: {
  workspaceId: string
  playlistId: string
  title: string
}): Promise<CoursePlaylistChapter> => {
  return await getApiClient().request<
    CoursePlaylistChapter,
    { title: string }
  >({
    method: "post",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/chapters`,
    data: { title: params.title },
  })
}

export const updatePlaylistChapter = async (params: {
  workspaceId: string
  playlistId: string
  chapterId: string
  data: { title?: string }
}): Promise<CoursePlaylistChapter> => {
  return await getApiClient().request<
    CoursePlaylistChapter,
    { title?: string }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/chapters/${params.chapterId}`,
    data: params.data,
  })
}

export const movePlaylistChapter = async (params: {
  workspaceId: string
  playlistId: string
  chapterId: string
  afterChapterId?: string | null
  beforeChapterId?: string | null
}) => {
  return await getApiClient().request<
    { chapterId: string; order: number },
    { afterChapterId?: string | null; beforeChapterId?: string | null }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/chapters/${params.chapterId}/position`,
    data: {
      afterChapterId: params.afterChapterId,
      beforeChapterId: params.beforeChapterId,
    },
  })
}

export const deletePlaylistChapter = async (params: {
  workspaceId: string
  playlistId: string
  chapterId: string
}): Promise<{ status: "deleted" }> => {
  return await getApiClient().request<{ status: "deleted" }, undefined>({
    method: "delete",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/chapters/${params.chapterId}`,
  })
}

export const movePlaylistVideo = async (params: {
  workspaceId: string
  playlistId: string
  videoId: string
  /** Video that should end up immediately BEFORE the moved one. null = top. */
  afterId?: string | null
  /** Video that should end up immediately AFTER the moved one. null = bottom. */
  beforeId?: string | null
}) => {
  return await getApiClient().request<
    { videoId: string; order: number },
    { afterId?: string | null; beforeId?: string | null }
  >({
    method: "patch",
    url: `/workspaces/${params.workspaceId}/playlists/${params.playlistId}/videos/${params.videoId}/position`,
    data: { afterId: params.afterId, beforeId: params.beforeId },
  })
}

export const listPlaylists = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
}): Promise<ApiTypes.ListPlaylistsOutputOutput> => {
  return await getApiClient().request<
    ApiTypes.ListPlaylistsOutputOutput,
    undefined
  >({
    method: "get",
    url: `/workspaces/${params.workspaceId}/playlists`,
    params: { curPage: params.curPage, perPage: params.perPage },
  })
}
