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
    url: string
    duration?: number | null
    thumbnailUrl?: string | null
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
      url: string
      duration?: number | null
      thumbnailUrl?: string | null
      errorMessage?: string | null
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
