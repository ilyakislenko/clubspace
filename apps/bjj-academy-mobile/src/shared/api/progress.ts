import { getApiClient } from "./client"

export type SaveVideoProgressResponse = {
  videoId: string
  position: number
  completed: boolean
  watchedAt: string
}

export const saveVideoProgress = async (params: {
  videoId: string
  position?: number
  completed?: boolean
}): Promise<SaveVideoProgressResponse> => {
  return await getApiClient().request<
    SaveVideoProgressResponse,
    { position?: number; completed?: boolean }
  >({
    method: "post",
    url: `/videos/${params.videoId}/progress`,
    data: { position: params.position, completed: params.completed },
  })
}
