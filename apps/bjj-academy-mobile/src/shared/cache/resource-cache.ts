import * as FileSystem from "expo-file-system/legacy"

import { safeDelete, safeMakeDir, safeReadString, safeWriteString } from "../fs-safe"

// Persistent read-through cache for API responses, so screens can paint
// instantly from the last snapshot (and work offline) while a fresh copy loads
// in the background. One JSON file per key under the app's document directory.
const CACHE_DIR = `${FileSystem.documentDirectory}resource-cache/`

type Envelope<T> = { savedAt: number; data: T }

// Cache keys are app-controlled (e.g. "announcements:<workspaceId>"), so we
// only need to neutralize anything that isn't filename-safe. Pure + exported
// for unit testing.
export const cacheFileName = (key: string): string =>
  `${key.replace(/[^a-zA-Z0-9_.-]/g, "_")}.json`

const cachePath = (key: string) => `${CACHE_DIR}${cacheFileName(key)}`

let dirEnsured = false
const ensureDir = async () => {
  if (dirEnsured) return
  await safeMakeDir(CACHE_DIR)
  dirEnsured = true
}

export type CachedSnapshot<T> = { data: T; savedAt: number }

export const readResource = async <T>(
  key: string,
): Promise<CachedSnapshot<T> | null> => {
  const raw = await safeReadString(cachePath(key))
  if (!raw) return null
  try {
    const env = JSON.parse(raw) as Envelope<T>
    if (!env || typeof env.savedAt !== "number") return null
    return { data: env.data, savedAt: env.savedAt }
  } catch {
    return null
  }
}

export const writeResource = async <T>(
  key: string,
  data: T,
): Promise<void> => {
  await ensureDir()
  const env: Envelope<T> = { savedAt: Date.now(), data }
  await safeWriteString(cachePath(key), JSON.stringify(env))
}

// Wipe the whole cache — call on sign-out so a different user never sees the
// previous account's cached lists.
export const clearResourceCache = async (): Promise<void> => {
  await safeDelete(CACHE_DIR)
  dirEnsured = false
}
