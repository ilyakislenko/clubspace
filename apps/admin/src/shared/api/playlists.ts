import { getApiClient } from "./client"

export interface PlaylistPayload {
  title: string
  slug: string
  description?: string | null
  thumbnailUrl?: string | null
  status?: string | null
  accessLevel?: string | null
  level?: string | null
  lockedProgression?: boolean
  tags?: string[]
}

export interface PlaylistResponse {
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

export type CoursePlaylistVideo = {
  id: string
  title: string
  description?: string | null
  status: string
  duration?: number | null
  thumbnailUrl?: string | null
  order: number
}

export type CoursePlaylistDetail = PlaylistResponse & {
  videos: CoursePlaylistVideo[]
}

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
}): Promise<{ data: PlaylistResponse[]; total: number; curPage: number; perPage: number }> => {
  return await getApiClient().request<
    { data: PlaylistResponse[]; total: number; curPage: number; perPage: number },
    undefined
  >({
    method: "get",
    url: `/workspaces/${params.workspaceId}/playlists`,
    params: { curPage: params.curPage, perPage: params.perPage },
  })
}
