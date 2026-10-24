import { clearAllOffline } from "../features/offline/offline-store"
import { clearUserPrefsData } from "../features/profile/preferences-store"
import { clearPlaybackProgress } from "../features/video/playback-progress"

// Wipes everything on-device that belongs to the signed-in user (recents,
// notes, bookmarks, pins, favorites cache, playback progress, offline
// downloads). Device-level preferences are intentionally kept. Best-effort:
// one failing store must not block the rest or sign-out.
export const clearUserLocalData = async (): Promise<void> => {
  await Promise.allSettled([
    clearUserPrefsData(),
    clearPlaybackProgress(),
    clearAllOffline(),
  ])
}
