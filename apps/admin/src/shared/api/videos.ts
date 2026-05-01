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
    createdAt: string
    updatedAt: string
  }>({
    method: "get",
    url: `/admin/videos/${params.videoId}`,
    params: { workspaceId: params.workspaceId },
  })
}

export const listVideos = async (params: {
  workspaceId: string
  curPage?: number
  perPage?: number
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
