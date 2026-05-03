import * as FileSystem from "expo-file-system/legacy"

import type { CourseDetail, CourseSummary } from "../../shared/api/courses"
import type { VideoDetail } from "../../shared/api/videos"

const ROOT = `${FileSystem.documentDirectory}offline/`
const VIDEOS_DIR = `${ROOT}videos/`
const COURSES_DIR = `${ROOT}courses/`

const ensureDir = async (path: string) => {
  const info = await FileSystem.getInfoAsync(path)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true })
  }
}

const ensureRoot = async () => {
  await ensureDir(ROOT)
  await ensureDir(VIDEOS_DIR)
  await ensureDir(COURSES_DIR)
}

const videoDir = (videoId: string) => `${VIDEOS_DIR}${videoId}/`
const manifestPath = (videoId: string) => `${videoDir(videoId)}master.m3u8`
const videoMetaPath = (videoId: string) => `${videoDir(videoId)}meta.json`
const videoThumbPath = (videoId: string, ext: string) =>
  `${videoDir(videoId)}thumb.${ext}`
const courseMetaPath = (courseId: string) =>
  `${COURSES_DIR}${courseId}.json`

export type OfflineVideoEntry = {
  videoId: string
  video: VideoDetail
  course?: CourseSummary
  savedAt: string
  thumbnailLocalUri?: string
  manifestUri: string
  bytes?: number
}

type OfflineVideoMeta = {
  video: VideoDetail
  course?: CourseSummary
  savedAt: string
  thumbnailFile?: string
}

export type OfflineDownloadProgress =
  | { phase: "manifest" }
  | { phase: "segments"; done: number; total: number }
  | { phase: "thumbnail" }
  | { phase: "done" }

export const getOfflineManifestUri = async (
  videoId: string,
): Promise<string | null> => {
  try {
    const info = await Promise.race([
      FileSystem.getInfoAsync(manifestPath(videoId)),
      new Promise<{ exists: false }>((resolve) =>
        setTimeout(() => resolve({ exists: false }), 1500),
      ),
    ])
    return info.exists ? (info as { uri: string }).uri : null
  } catch {
    return null
  }
}

export const offlineDirExists = async (videoId: string) => {
  const info = await FileSystem.getInfoAsync(videoDir(videoId))
  return info.exists
}

export const removeOffline = async (videoId: string) => {
  try {
    const info = await FileSystem.getInfoAsync(videoDir(videoId))
    if (info.exists) {
      await FileSystem.deleteAsync(videoDir(videoId), { idempotent: true })
    }
  } catch {
    /* noop */
  }
}

const writeJson = async (path: string, value: unknown) => {
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value))
}

const readJson = async <T,>(path: string): Promise<T | null> => {
  const info = await FileSystem.getInfoAsync(path)
  if (!info.exists) return null
  try {
    const raw = await FileSystem.readAsStringAsync(path)
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const getCachedVideo = async (
  videoId: string,
): Promise<OfflineVideoEntry | null> => {
  const meta = await readJson<OfflineVideoMeta>(videoMetaPath(videoId))
  if (!meta) return null
  const manifestInfo = await FileSystem.getInfoAsync(manifestPath(videoId))
  if (!manifestInfo.exists) return null
  const thumb = meta.thumbnailFile
    ? await FileSystem.getInfoAsync(`${videoDir(videoId)}${meta.thumbnailFile}`)
    : null
  return {
    videoId,
    video: meta.video,
    course: meta.course,
    savedAt: meta.savedAt,
    thumbnailLocalUri: thumb?.exists ? thumb.uri : undefined,
    manifestUri: manifestInfo.uri,
  }
}

export const getCachedCourse = async (
  courseId: string,
): Promise<CourseDetail | null> => {
  return await readJson<CourseDetail>(courseMetaPath(courseId))
}

export const cacheCourse = async (course: CourseDetail) => {
  await ensureRoot()
  await writeJson(courseMetaPath(course.id), course)
}

const downloadThumbnail = async (
  videoId: string,
  url: string,
): Promise<string | undefined> => {
  try {
    const ext = (url.split("?")[0].split(".").pop() ?? "jpg").slice(0, 5)
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : "jpg"
    const filename = `thumb.${safeExt}`
    const dest = videoThumbPath(videoId, safeExt)
    const result = await FileSystem.downloadAsync(url, dest)
    if (result.status >= 400) return undefined
    return filename
  } catch {
    return undefined
  }
}

const fetchManifestText = async (manifestUrl: string) => {
  const res = await fetch(manifestUrl)
  if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`)
  return res.text()
}

const downloadSegments = async (params: {
  videoId: string
  manifestText: string
  onProgress?: (done: number, total: number) => void
}): Promise<string> => {
  const { videoId, manifestText } = params
  const dir = videoDir(videoId)
  const lines = manifestText.split(/\r?\n/)
  const segmentIndices: number[] = []
  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#")) segmentIndices.push(idx)
  })

  const total = segmentIndices.length
  if (total === 0) {
    throw new Error("Manifest contains no segments")
  }

  const localLines = [...lines]
  let done = 0

  for (const idx of segmentIndices) {
    const url = lines[idx].trim()
    const filename = `seg-${done.toString().padStart(4, "0")}.ts`
    const local = `${dir}${filename}`
    const result = await FileSystem.downloadAsync(url, local)
    if (result.status >= 400) {
      throw new Error(`Segment HTTP ${result.status}`)
    }
    localLines[idx] = filename
    done += 1
    params.onProgress?.(done, total)
  }

  const localManifest = localLines.join("\n")
  await FileSystem.writeAsStringAsync(manifestPath(videoId), localManifest)
  return manifestPath(videoId)
}

export const downloadVideoForOffline = async (params: {
  videoId: string
  manifestUrl: string
  video: VideoDetail
  course?: CourseSummary
  thumbnailUrl?: string | null
  onProgress?: (progress: OfflineDownloadProgress) => void
}) => {
  await ensureRoot()
  await ensureDir(videoDir(params.videoId))

  params.onProgress?.({ phase: "manifest" })
  const manifestText = await fetchManifestText(params.manifestUrl)

  await downloadSegments({
    videoId: params.videoId,
    manifestText,
    onProgress: (done, total) =>
      params.onProgress?.({ phase: "segments", done, total }),
  })

  let thumbnailFile: string | undefined
  if (params.thumbnailUrl) {
    params.onProgress?.({ phase: "thumbnail" })
    thumbnailFile = await downloadThumbnail(
      params.videoId,
      params.thumbnailUrl,
    )
  }

  const meta: OfflineVideoMeta = {
    video: params.video,
    course: params.course,
    savedAt: new Date().toISOString(),
    thumbnailFile,
  }
  await writeJson(videoMetaPath(params.videoId), meta)
  params.onProgress?.({ phase: "done" })

  return manifestPath(params.videoId)
}

export const listOfflineEntries = async (): Promise<OfflineVideoEntry[]> => {
  await ensureRoot()
  let ids: string[]
  try {
    ids = await FileSystem.readDirectoryAsync(VIDEOS_DIR)
  } catch {
    return []
  }
  const entries = await Promise.all(ids.map((id) => getCachedVideo(id)))
  return entries
    .filter((e): e is OfflineVideoEntry => Boolean(e))
    .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1))
}

export const getOfflineRootSizeBytes = async (): Promise<number> => {
  // Rough sum: walk videos/<id>/* and add up.
  await ensureRoot()
  let total = 0
  try {
    const ids = await FileSystem.readDirectoryAsync(VIDEOS_DIR)
    for (const id of ids) {
      const files = await FileSystem.readDirectoryAsync(videoDir(id))
      for (const f of files) {
        const info = await FileSystem.getInfoAsync(`${videoDir(id)}${f}`)
        if (info.exists && !info.isDirectory) {
          // legacy FileSystem types: size is on the FileInfo when exists is true
          total += (info as { size?: number }).size ?? 0
        }
      }
    }
  } catch {
    /* noop */
  }
  return total
}

export const clearAllOffline = async () => {
  try {
    const info = await FileSystem.getInfoAsync(ROOT)
    if (info.exists) {
      await FileSystem.deleteAsync(ROOT, { idempotent: true })
    }
  } catch {
    /* noop */
  }
}
