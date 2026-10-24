import { setPlaybackWritesEnabled } from "../features/video/playback-progress"
import { clearUserLocalData } from "./clear-user-local-data"
import { kvDelete, kvGet, kvSet } from "./kv"

const LOCAL_OWNER_KEY = "clubspace.localOwnerId"

// Called at sign-in, before any screen reads local data. If a different
// account owned the on-device data (forced sign-outs deliberately keep it),
// wipe it so the next person on a shared phone never sees it.
export const reconcileLocalOwner = async (userId: string): Promise<void> => {
  const stored = await kvGet(LOCAL_OWNER_KEY).catch(() => null)
  if (stored && stored !== userId) await clearUserLocalData()
  await kvSet(LOCAL_OWNER_KEY, userId).catch(() => undefined)
  setPlaybackWritesEnabled(true)
}

// Explicit sign-out / account deletion wipe; a session-expiry sign-out keeps
// the data (it is device-only and the same user normally returns).
export const cleanupOnSignOut = async (opts: {
  wipeLocal: boolean
}): Promise<void> => {
  if (!opts.wipeLocal) return
  await clearUserLocalData()
  await kvDelete(LOCAL_OWNER_KEY).catch(() => undefined)
}
