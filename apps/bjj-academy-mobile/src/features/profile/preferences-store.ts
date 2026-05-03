import * as FileSystem from "expo-file-system/legacy"

const ROOT = `${FileSystem.documentDirectory}prefs/`
const PREFERENCES_FILE = `${ROOT}preferences.json`
const FAVORITES_FILE = `${ROOT}favorites.json`
const RECENTS_FILE = `${ROOT}recents.json`

export type Preferences = {
  language: "ru" | "en"
  autoplay: boolean
  defaultQuality: "auto" | "1080p" | "720p" | "480p"
  notifyNewVideos: boolean
  notifyAccessExpiring: boolean
}

const DEFAULT_PREFERENCES: Preferences = {
  language: "ru",
  autoplay: true,
  defaultQuality: "auto",
  notifyNewVideos: true,
  notifyAccessExpiring: true,
}

const ensureRoot = async () => {
  const info = await FileSystem.getInfoAsync(ROOT)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true })
  }
}

const readJsonOrDefault = async <T,>(path: string, fallback: T): Promise<T> => {
  await ensureRoot()
  const info = await FileSystem.getInfoAsync(path)
  if (!info.exists) return fallback
  try {
    const raw = await FileSystem.readAsStringAsync(path)
    return { ...fallback, ...(JSON.parse(raw) as object) } as T
  } catch {
    return fallback
  }
}

const writeJson = async (path: string, value: unknown) => {
  await ensureRoot()
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value))
}

export const getPreferences = async (): Promise<Preferences> => {
  return readJsonOrDefault(PREFERENCES_FILE, DEFAULT_PREFERENCES)
}

export const setPreferences = async (
  patch: Partial<Preferences>,
): Promise<Preferences> => {
  const current = await getPreferences()
  const next = { ...current, ...patch }
  await writeJson(PREFERENCES_FILE, next)
  return next
}

// ---- Favorites ----

const readFavorites = async (): Promise<string[]> => {
  await ensureRoot()
  const info = await FileSystem.getInfoAsync(FAVORITES_FILE)
  if (!info.exists) return []
  try {
    const raw = await FileSystem.readAsStringAsync(FAVORITES_FILE)
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export const isFavorite = async (videoId: string): Promise<boolean> => {
  const favs = await readFavorites()
  return favs.includes(videoId)
}

export const listFavorites = async (): Promise<string[]> => {
  return await readFavorites()
}

export const toggleFavorite = async (videoId: string): Promise<boolean> => {
  const favs = await readFavorites()
  const next = favs.includes(videoId)
    ? favs.filter((id) => id !== videoId)
    : [...favs, videoId]
  await writeJson(FAVORITES_FILE, next)
  return next.includes(videoId)
}

// ---- Recently watched (cross-course) ----

export type RecentEntry = {
  videoId: string
  courseId?: string
  title: string
  thumbnailUrl?: string | null
  watchedAt: string
}

const readRecents = async (): Promise<RecentEntry[]> => {
  await ensureRoot()
  const info = await FileSystem.getInfoAsync(RECENTS_FILE)
  if (!info.exists) return []
  try {
    const raw = await FileSystem.readAsStringAsync(RECENTS_FILE)
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : []
  } catch {
    return []
  }
}

export const recordRecent = async (entry: Omit<RecentEntry, "watchedAt">) => {
  const list = await readRecents()
  const filtered = list.filter((e) => e.videoId !== entry.videoId)
  const next = [
    { ...entry, watchedAt: new Date().toISOString() },
    ...filtered,
  ].slice(0, 30)
  await writeJson(RECENTS_FILE, next)
}

export const listRecents = async (): Promise<RecentEntry[]> => {
  return await readRecents()
}

export const clearRecents = async () => {
  await writeJson(RECENTS_FILE, [])
}
