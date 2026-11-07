import type { CourseSummary } from "../../shared/api/courses"
import type { OfflineDownloadProgress } from "./offline-types"

// «Скачать для тренировки»: the pure rules of downloading a set of lessons in
// one go (a course, a study plan, the review deck). use-bulk-download runs them.

/** One lesson a bulk download may fetch. */
export type BulkDownloadTarget = {
  videoId: string
  thumbnailUrl?: string | null
  // Stored with the copy so the offline library and player can name the course.
  course?: CourseSummary
}

/** Each lesson once, in first-seen order (a plan may repeat a lesson). */
export const uniqueTargets = <T extends { videoId: string }>(
  targets: readonly T[],
): T[] => {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const target of targets) {
    if (seen.has(target.videoId)) continue
    seen.add(target.videoId)
    unique.push(target)
  }
  return unique
}

/** What still has to be fetched: lessons without a ready local copy. */
export const missingTargets = <T extends { videoId: string }>(
  targets: readonly T[],
  local: ReadonlySet<string>,
): T[] => targets.filter((t) => !local.has(t.videoId))

/** How many of the lessons already have a ready local copy. */
export const localCount = (
  targets: readonly { videoId: string }[],
  local: ReadonlySet<string>,
): number => targets.filter((t) => local.has(t.videoId)).length

/** The running lesson's step, shown after «2 из 5 ·». */
export const phaseLabel = (p: OfflineDownloadProgress): string => {
  switch (p.phase) {
    case "video":
      return p.total > 0 ? `${Math.round((p.done / p.total) * 100)}%` : "видео"
    case "thumbnail":
      return "превью"
    case "done":
      return "готово"
  }
}

/** How far the running lesson is, 0..1 (the cover counts as finished video). */
export const phaseFraction = (p: OfflineDownloadProgress): number => {
  switch (p.phase) {
    case "video":
      return p.total > 0 ? Math.min(Math.max(p.done / p.total, 0), 1) : 0
    case "thumbnail":
    case "done":
      return 1
  }
}

/** The whole run's progress, 0..1: finished lessons plus the running one. */
export const combinedProgress = (p: {
  currentIndex: number
  totalVideos: number
  videoFraction: number
}): number => {
  if (p.totalVideos <= 0) return 0
  const fraction = Math.min(Math.max(p.videoFraction, 0), 1)
  return Math.min((p.currentIndex + fraction) / p.totalVideos, 1)
}

/** «Скачано 3 из 8» — lessons already on the device out of all of them. */
export const downloadedSummary = (local: number, total: number): string =>
  `Скачано ${local} из ${total}`

/** The finished run: «Скачано: 4, пропущено: 1. <why the first one failed>». */
export const bulkResultMessage = (p: {
  downloaded: number
  skipped: number
  reason: string | null
}): string =>
  `Скачано: ${p.downloaded}, пропущено: ${p.skipped}` +
  (p.reason ? `. ${p.reason}` : "")
