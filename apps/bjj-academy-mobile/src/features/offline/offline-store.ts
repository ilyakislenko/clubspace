import * as FileSystem from "expo-file-system/legacy"

const ROOT = `${FileSystem.documentDirectory}offline-videos/`

const ensureRoot = async () => {
  try {
    const info = await FileSystem.getInfoAsync(ROOT)
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true })
    }
  } catch {
    /* noop */
  }
}

export type OfflineState =
  | { status: "absent" }
  | { status: "downloading"; progress: number }
  | { status: "ready"; manifestUri: string }
  | { status: "error"; message: string }

const dirFor = (videoId: string) => `${ROOT}${videoId}/`
const manifestPath = (videoId: string) => `${dirFor(videoId)}master.m3u8`

export const offlineDirExists = async (videoId: string) => {
  const info = await FileSystem.getInfoAsync(dirFor(videoId))
  return info.exists
}

export const getOfflineManifestUri = async (
  videoId: string,
): Promise<string | null> => {
  const info = await FileSystem.getInfoAsync(manifestPath(videoId))
  return info.exists ? info.uri : null
}

export const removeOffline = async (videoId: string) => {
  try {
    const info = await FileSystem.getInfoAsync(dirFor(videoId))
    if (info.exists) {
      await FileSystem.deleteAsync(dirFor(videoId), { idempotent: true })
    }
  } catch {
    /* noop */
  }
}

/**
 * Download an HLS master manifest and all referenced segments to the device.
 *
 * The server already returns presigned segment URLs inside the manifest, so we
 * read each non-comment line, fetch it, save it as `seg-<n>.ts`, and write a
 * rewritten manifest where each line points at the local file.
 */
export const downloadHlsForOffline = async (params: {
  videoId: string
  manifestUrl: string
  onProgress?: (progress: number) => void
}) => {
  await ensureRoot()
  const dir = dirFor(params.videoId)
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true })

  const manifestText = await fetch(params.manifestUrl).then((r) => {
    if (!r.ok) throw new Error(`Manifest HTTP ${r.status}`)
    return r.text()
  })

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
    params.onProgress?.(done / total)
  }

  await FileSystem.writeAsStringAsync(
    manifestPath(params.videoId),
    localLines.join("\n"),
  )

  return manifestPath(params.videoId)
}

export const listOfflineVideoIds = async (): Promise<string[]> => {
  await ensureRoot()
  try {
    const ids = await FileSystem.readDirectoryAsync(ROOT)
    const present = await Promise.all(
      ids.map(async (id) => {
        const info = await FileSystem.getInfoAsync(manifestPath(id))
        return info.exists ? id : null
      }),
    )
    return present.filter((v): v is string => Boolean(v))
  } catch {
    return []
  }
}
