import type { ClubVocabulary } from "@clubspace/ui-kit/brand"

import type { VideoReviewStatus } from "../../shared/api/video-reviews"

// The server's limits for a clip (create-my-video-review): the picker checks
// them first, so a too-long or too-big file is refused before any upload.
export const MAX_CLIP_BYTES = 500 * 1024 * 1024
export const MAX_CLIP_DURATION_SEC = 10 * 60

// A comment stays «current» this long after its moment (a segment: its end).
export const ACTIVE_COMMENT_SEC = 4

// Cached resources: the member's list, the staff list and each request.
// invalidateResource(REVIEWS_RESOURCE, workspaceId) refreshes them all.
export const REVIEWS_RESOURCE = "video-reviews"
export const myReviewsCacheKey = (workspaceId: string) =>
  `${REVIEWS_RESOURCE}:${workspaceId}:mine`
export const clubReviewsCacheKey = (workspaceId: string) =>
  `${REVIEWS_RESOURCE}:${workspaceId}:club`
export const reviewCacheKey = (workspaceId: string, requestId: string) =>
  `${REVIEWS_RESOURCE}:${workspaceId}:${requestId}`

/** The status chip of a request, in the club's words. */
export const reviewStatusLabel = (
  status: VideoReviewStatus,
  vocabulary: Pick<ClubVocabulary, "coach">,
): string => {
  switch (status) {
    case "uploading":
      return "загружается"
    case "processing":
      return "обработка"
    case "failed":
      return "ошибка"
    case "open":
      return `ждёт ${vocabulary.coach.gen}`
    case "answered":
      return "есть ответ"
    case "closed":
      return "закрыт"
  }
}

/** Only a transcoded clip can be played (and commented on). */
export const isPlayable = (status: VideoReviewStatus): boolean =>
  status === "open" || status === "answered" || status === "closed"

export type PickedClip = {
  fileSize?: number | null
  // Milliseconds, as the picker reports it.
  duration?: number | null
  mimeType?: string | null
}

/** Why a picked file can't be sent, or null when it can. */
export const pickedClipProblem = (clip: PickedClip): string | null => {
  if (clip.mimeType && !clip.mimeType.startsWith("video/")) {
    return "Выберите видеофайл"
  }
  if (!clip.fileSize || clip.fileSize <= 0) {
    return "Не удалось узнать размер файла — выберите видео ещё раз"
  }
  if (clip.fileSize > MAX_CLIP_BYTES) {
    return "Видео больше 500 МБ — обрежьте его или снимите короче"
  }
  if (clip.duration != null && clip.duration / 1000 > MAX_CLIP_DURATION_SEC) {
    return "Видео длиннее 10 минут — обрежьте его до нужного момента"
  }
  return null
}

/** «12 %» of an upload; 0 before the size is known. */
export const uploadPercent = (sent: number, total: number): number =>
  total > 0 ? Math.min(100, Math.max(0, Math.floor((sent / total) * 100))) : 0

type TimedComment = { id: string; atSec: number; endSec: number | null }

/**
 * The comment playing now: the latest one whose moment has come and that is
 * still within its segment (or ACTIVE_COMMENT_SEC of a moment).
 */
export const activeCommentId = (
  comments: readonly TimedComment[],
  timeSec: number,
): string | null => {
  let found: TimedComment | null = null
  for (const c of comments) {
    const end = c.endSec ?? c.atSec + ACTIVE_COMMENT_SEC
    if (timeSec >= c.atSec && timeSec <= end && (!found || c.atSec >= found.atSec)) {
      found = c
    }
  }
  return found?.id ?? null
}

/** A title for the picked file: its name without the extension. */
export const titleFromFileName = (fileName: string | null | undefined): string =>
  (fileName ?? "").trim().replace(/\.[a-z0-9]{2,5}$/i, "").trim().slice(0, 200)
