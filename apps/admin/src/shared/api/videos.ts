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
      method: "POST",
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
      method: "POST",
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
    method: "GET",
    url: `/admin/videos/${params.videoId}`,
    params: { workspaceId: params.workspaceId },
  })
}
