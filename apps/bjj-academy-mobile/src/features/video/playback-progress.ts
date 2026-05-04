import * as FileSystem from "expo-file-system/legacy"

import { saveVideoProgress } from "../../shared/api/progress"

const PROGRESS_FILE = `${FileSystem.documentDirectory}playback-progress.json`

const RESUME_GUARD_SECONDS = 30
const COMPLETION_RATIO = 0.9

type ProgressEntry = {
  position: number
  updatedAt: number
  /** True if user finished playback or marked it explicitly. */
  completed?: boolean
}

type ProgressMap = Record<string, ProgressEntry>

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
  if (entry.completed) return 0
  if (entry.position < 1) return 0
  if (durationSeconds && entry.position > durationSeconds - RESUME_GUARD_SECONDS) {
    return 0
  }
  return entry.position
}

// Server sync is best-effort — if the call fails we keep the local copy.
const syncToServer = (
  videoId: string,
  position: number,
  completed?: boolean,
  duration?: number,
) => {
  void saveVideoProgress({ videoId, position, completed, duration }).catch(
    () => {
      /* offline / 401 / etc. — local state is the source of truth */
    },
  )
}

export const saveProgress = async (
  videoId: string,
  position: number,
  duration?: number,
) => {
  const map = await load()
  const prev = map[videoId]
  map[videoId] = {
    position,
    updatedAt: Date.now(),
    completed: prev?.completed,
  }
  await persist()
  syncToServer(videoId, position, prev?.completed, duration)
}

export const clearProgress = async (videoId: string) => {
  const map = await load()
  delete map[videoId]
  await persist()
}

export const markCompleted = async (videoId: string, duration?: number) => {
  const map = await load()
  map[videoId] = {
    position: 0,
    updatedAt: Date.now(),
    completed: true,
  }
  await persist()
  syncToServer(videoId, 0, true, duration)
}

export const unmarkCompleted = async (videoId: string) => {
  const map = await load()
  if (map[videoId]) {
    map[videoId] = { ...map[videoId], completed: false }
    await persist()
    syncToServer(videoId, map[videoId].position, false)
  }
}

export type ProgressStatus = {
  status: "unwatched" | "in-progress" | "watched"
  position: number
  ratio: number
}

export const getProgressStatus = async (
  videoId: string,
  durationSeconds?: number | null,
): Promise<ProgressStatus> => {
  const map = await load()
  const entry = map[videoId]
  if (!entry || (!entry.completed && entry.position <= 0)) {
    return { status: "unwatched", position: 0, ratio: 0 }
  }
  if (entry.completed) {
    return { status: "watched", position: entry.position, ratio: 1 }
  }
  const ratio =
    durationSeconds && durationSeconds > 0
      ? Math.min(entry.position / durationSeconds, 1)
      : 0
  if (ratio >= COMPLETION_RATIO) {
    return { status: "watched", position: entry.position, ratio: 1 }
  }
  return { status: "in-progress", position: entry.position, ratio }
}

export const getProgressMap = async (): Promise<ProgressMap> => {
  return await load()
}

export const getCourseProgressSummary = async (params: {
  videos: Array<{ id: string; duration?: number | null }>
}): Promise<{ watched: number; total: number }> => {
  const map = await load()
  let watched = 0
  for (const v of params.videos) {
    const e = map[v.id]
    if (!e) continue
    if (e.completed) {
      watched += 1
      continue
    }
    if (
      v.duration &&
      v.duration > 0 &&
      e.position / v.duration >= COMPLETION_RATIO
    ) {
      watched += 1
    }
  }
  return { watched, total: params.videos.length }
}
