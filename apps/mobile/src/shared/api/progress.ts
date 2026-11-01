import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

export type SaveVideoProgressResponse = ApiTypes.SaveVideoProgressOutputOutput

export type VideoProgressBody = {
  position?: number
  completed?: boolean
  duration?: number
}

// Also what the offline outbox replays (playback-progress.ts).
export const videoProgressUrl = (videoId: string) => `/videos/${videoId}/progress`

export const saveVideoProgress = async (
  params: { videoId: string } & VideoProgressBody,
): Promise<SaveVideoProgressResponse> => {
  return await getApiClient().request<SaveVideoProgressResponse, VideoProgressBody>({
    method: "post",
    url: videoProgressUrl(params.videoId),
    data: {
      position: params.position,
      completed: params.completed,
      duration: params.duration,
    },
  })
}
