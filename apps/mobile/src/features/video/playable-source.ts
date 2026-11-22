import { getStreamingUri, getVideo, type VideoDetail } from "../../shared/api/videos"
import { isOnline } from "../offline/network-policy"
import { getCachedVideo, getOfflineVideoState } from "../offline/offline-store"
import { lostReasonMessage } from "../offline/offline-types"

export type PlayableLesson = {
  video: VideoDetail
  uri: string
  // Playing the downloaded copy (no network, or the server unreachable).
  offline: boolean
}

/**
 * A lesson's details and what to play, by VideoScreen's rules: stream while
 * online (fresher, and iOS can't play a downloaded HLS playlist from file://),
 * the downloaded copy when offline, and the downloaded copy with its stored
 * details when the server can't be reached.
 */
export const resolvePlayableLesson = async (
  workspaceId: string,
  videoId: string,
): Promise<PlayableLesson> => {
  const local = await getOfflineVideoState(videoId, { revalidate: true })
  try {
    const video = await getVideo({ workspaceId, videoId })
    if (local.status === "ready" && !(await isOnline())) {
      return { video, uri: local.uri, offline: true }
    }
    return { video, uri: await getStreamingUri({ videoId }), offline: false }
  } catch (err) {
    const cached = await getCachedVideo(videoId)
    if (cached) return { video: cached.video, uri: cached.videoUri, offline: true }
    if (local.status === "lost") throw new Error(lostReasonMessage(local.reason))
    throw err
  }
}
