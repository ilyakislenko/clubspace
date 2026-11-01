import type { CourseSummary } from "../../shared/api/courses"
import type { VideoDetail } from "../../shared/api/videos"

// The contract both offline stores implement: `offline-store.ts` (native,
// expo-file-system, one progressive MP4) and `offline-store.web.ts` (browser,
// Cache Storage, the HLS rendition from the offline manifest). Screens import
// "./offline-store" and Metro picks the platform file.

// Why a download can no longer be played:
// - expired: offline longer than the access window (offline-access.ts)
// - revoked: the server refused access (membership, audience, trial)
// - evicted: the browser dropped the stored files to free space
export type OfflineLostReason = "expired" | "revoked" | "evicted"

export const lostReasonMessage = (reason: OfflineLostReason): string => {
  switch (reason) {
    case "expired":
      return "Офлайн-доступ истёк: урок давно не проверялся на сервере. Подключитесь к интернету и скачайте снова."
    case "revoked":
      return "Доступ к уроку закрыт, загрузка удалена."
    case "evicted":
      return "Браузер удалил загруженные файлы, чтобы освободить место. Скачайте снова."
  }
}

type OfflineEntryBase = {
  videoId: string
  video: VideoDetail
  course?: CourseSummary
  savedAt: string
  thumbnailLocalUri?: string
  bytes?: number
}

export type ReadyOfflineVideoEntry = OfflineEntryBase & {
  status: "ready"
  videoUri: string
  // Web only: offline playback stops after this unless the server re-confirms.
  accessExpiresAt?: number
}

export type OfflineVideoEntry =
  | ReadyOfflineVideoEntry
  // Web only: a paused or interrupted download; `progress` is 0..1.
  | (OfflineEntryBase & { status: "partial"; progress: number; active: boolean })
  // Web only: kept as a stub so the list can say «скачайте снова».
  | (OfflineEntryBase & { status: "lost"; lostReason: OfflineLostReason })

export type OfflineVideoState =
  | { status: "absent" }
  | { status: "ready"; uri: string; accessExpiresAt?: number }
  | { status: "partial"; progress: number; active: boolean }
  | { status: "lost"; reason: OfflineLostReason }

export type OfflineDownloadProgress =
  | {
      phase: "video"
      done: number
      total: number
      // Web: bytes stored so far and the projected total (offline-budget.ts).
      bytes?: number
      estimatedBytes?: number
    }
  | { phase: "thumbnail" }
  | { phase: "done" }

// Thrown by downloadVideoForOffline when the user paused or cancelled it.
export class OfflineDownloadInterrupted extends Error {
  constructor(readonly reason: "paused" | "cancelled") {
    super(reason === "paused" ? "Загрузка на паузе" : "Загрузка отменена")
    this.name = "OfflineDownloadInterrupted"
  }
}

// Pause/cancel/observe a running download. Native downloads run to completion
// (the store exports `null`); the web store implements them.
export type OfflineDownloadControls = {
  // Stops fetching and keeps what's stored; downloadVideoForOffline resumes.
  pause: (videoId: string) => void
  // Stops fetching (if running) and deletes everything stored for the video.
  cancel: (videoId: string) => Promise<void>
  // Progress of any running download, `null` when one stops. Lets a screen
  // that remounts mid-download keep showing it.
  subscribe: (
    listener: (videoId: string, progress: OfflineDownloadProgress | null) => void,
  ) => () => void
}
