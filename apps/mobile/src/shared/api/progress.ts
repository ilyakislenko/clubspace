import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type SaveVideoProgressResponse = ApiTypes.SaveVideoProgressOutputOutput

export const saveVideoProgress = async (params: {
  videoId: string
  position?: number
  completed?: boolean
  duration?: number
}): Promise<SaveVideoProgressResponse> => {
  return await getApiClient().request<
    SaveVideoProgressResponse,
    { position?: number; completed?: boolean; duration?: number }
  >({
    method: "post",
    url: `/videos/${params.videoId}/progress`,
    data: {
      position: params.position,
      completed: params.completed,
      duration: params.duration,
    },
  })
}
