import * as FileSystem from "expo-file-system/legacy"

import type { CourseDetail, CourseSummary } from "../../shared/api/courses"
import type { VideoDetail } from "../../shared/api/videos"
import {
  safeDelete,
  safeGetInfo,
  safeListDir,
  safeMakeDir,
  safeReadString,
  safeWriteString,
} from "../../shared/fs-safe"

const ROOT = `${FileSystem.documentDirectory}offline/`
const VIDEOS_DIR = `${ROOT}videos/`
const COURSES_DIR = `${ROOT}courses/`

let rootEnsured = false
const ensureRoot = async () => {
  if (rootEnsured) return
  await safeMakeDir(ROOT)
  await safeMakeDir(VIDEOS_DIR)
  await safeMakeDir(COURSES_DIR)
  rootEnsured = true
}

const ensureVideoDir = async (videoId: string) => {
  await ensureRoot()
  await safeMakeDir(videoDir(videoId))
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
  const info = await safeGetInfo(manifestPath(videoId))
  return info.exists ? info.uri ?? manifestPath(videoId) : null
}

export const offlineDirExists = async (videoId: string) => {
  const info = await safeGetInfo(videoDir(videoId))
  return info.exists
}

export const removeOffline = async (videoId: string) => {
  await safeDelete(videoDir(videoId))
}

const writeJson = async (path: string, value: unknown) => {
  await safeWriteString(path, JSON.stringify(value))
}

const readJson = async <T,>(path: string): Promise<T | null> => {
  const raw = await safeReadString(path)
  if (!raw) return null
  try {
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
  const manifestInfo = await safeGetInfo(manifestPath(videoId))
  if (!manifestInfo.exists) return null
  const thumb = meta.thumbnailFile
    ? await safeGetInfo(`${videoDir(videoId)}${meta.thumbnailFile}`)
    : null
  return {
    videoId,
    video: meta.video,
    course: meta.course,
    savedAt: meta.savedAt,
    thumbnailLocalUri: thumb?.exists ? thumb.uri : undefined,
    manifestUri: manifestInfo.uri ?? manifestPath(videoId),
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
  await safeWriteString(manifestPath(videoId), localManifest)
  return manifestPath(videoId)
}

export const downloadVideoForOffline = async (params: {
  videoId: string
  // A flat HLS media playlist (one rung) whose segment lines are absolute,
  // downloadable URLs — fetched from GET /videos/:id/offline-manifest.
  manifestText: string
  video: VideoDetail
  course?: CourseSummary
  thumbnailUrl?: string | null
  onProgress?: (progress: OfflineDownloadProgress) => void
}) => {
  await ensureVideoDir(params.videoId)

  try {
    params.onProgress?.({ phase: "manifest" })

    await downloadSegments({
      videoId: params.videoId,
      manifestText: params.manifestText,
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
  } catch (error) {
    // A partial download (segments without meta.json) is invisible in the
    // library but still eats disk — wipe it so a retry starts clean.
    await removeOffline(params.videoId)
    throw error
  }
}

export const listOfflineEntries = async (): Promise<OfflineVideoEntry[]> => {
  await ensureRoot()
  const ids = await safeListDir(VIDEOS_DIR)
  const entries = await Promise.all(ids.map((id) => getCachedVideo(id)))
  return entries
    .filter((e): e is OfflineVideoEntry => Boolean(e))
    .sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1))
}

export const getOfflineRootSizeBytes = async (): Promise<number> => {
  await ensureRoot()
  let total = 0
  const ids = await safeListDir(VIDEOS_DIR)
  for (const id of ids) {
    const files = await safeListDir(videoDir(id))
    for (const f of files) {
      const info = await safeGetInfo(`${videoDir(id)}${f}`)
      if (info.exists && !info.isDirectory) {
        total += info.size ?? 0
      }
    }
  }
  return total
}

export const clearAllOffline = async () => {
  await safeDelete(ROOT)
  rootEnsured = false
}
