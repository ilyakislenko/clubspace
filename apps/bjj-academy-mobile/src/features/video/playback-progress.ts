import * as FileSystem from "expo-file-system/legacy"

const PROGRESS_FILE = `${FileSystem.documentDirectory}playback-progress.json`

const RESUME_GUARD_SECONDS = 30

type ProgressMap = Record<string, { position: number; updatedAt: number }>

let cache: ProgressMap | null = null

const load = async (): Promise<ProgressMap> => {
  if (cache) return cache
  try {
    const info = await FileSystem.getInfoAsync(PROGRESS_FILE)
    if (!info.exists) {
      cache = {}
      return cache
    }
    const text = await FileSystem.readAsStringAsync(PROGRESS_FILE)
    cache = (JSON.parse(text) as ProgressMap) ?? {}
  } catch {
    cache = {}
  }
  return cache
}

const persist = async () => {
  if (!cache) return
  try {
    await FileSystem.writeAsStringAsync(PROGRESS_FILE, JSON.stringify(cache))
  } catch {
    /* noop */
  }
}

export const getResumePosition = async (
  videoId: string,
  durationSeconds?: number | null,
): Promise<number> => {
  const map = await load()
  const entry = map[videoId]
  if (!entry) return 0
  if (entry.position < 1) return 0
  if (durationSeconds && entry.position > durationSeconds - RESUME_GUARD_SECONDS) {
    return 0
  }
  return entry.position
}

export const saveProgress = async (videoId: string, position: number) => {
  const map = await load()
  map[videoId] = { position, updatedAt: Date.now() }
  await persist()
}

export const clearProgress = async (videoId: string) => {
  const map = await load()
  delete map[videoId]
  await persist()
}
