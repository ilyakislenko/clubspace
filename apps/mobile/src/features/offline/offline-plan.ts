// Turns the server's offline manifest (GET /videos/:id/offline-manifest: a flat
// single-rung HLS media playlist whose URIs are absolute, short-lived presigned
// links) into a download plan for the browser: which remote files to fetch,
// where each one lives locally, and the playlist the player reads offline.
//
// Pure and platform-free so the rules are unit-tested; the web offline store
// does the fetching and the storing.

export type OfflineResourceKind = "segment" | "key" | "init"

export type OfflineResource = {
  kind: OfflineResourceKind
  // Presigned and valid for 30 minutes — re-fetch the manifest to refresh.
  remoteUrl: string
  // Relative to the video's local base, e.g. "seg/00012.ts". Stable across
  // manifest refreshes, which is what lets a paused download resume.
  localPath: string
  durationSec: number
}

export type OfflinePlan = {
  resources: OfflineResource[]
  segmentCount: number
  totalDurationSec: number
  // Identifies the rendition; a resumed download only reuses already stored
  // files when the fresh manifest still has the same fingerprint.
  fingerprint: string
  // The playlist the player loads offline, every URI pointing at `localBase`.
  playlist: string
}

export class OfflinePlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OfflinePlanError"
  }
}

const UNSUPPORTED = "Этот урок нельзя скачать в браузере: неподдерживаемый формат видео."

const isAbsoluteHttp = (uri: string): boolean => /^https?:\/\//i.test(uri)

const pad = (n: number): string => String(n).padStart(5, "0")

const extensionOf = (url: string, fallback: string): string => {
  const path = url.split(/[?#]/)[0]
  const ext = path.includes(".") ? path.split(".").pop() ?? "" : ""
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : fallback
}

/**
 * @param manifest the `manifest` string the server returned
 * @param localBase absolute URL prefix ending in "/" that local paths hang off
 */
export const buildOfflinePlan = (
  manifest: string,
  localBase: string,
): OfflinePlan => {
  const lines = manifest.split(/\r?\n/)
  if (lines[0]?.trim() !== "#EXTM3U") {
    throw new OfflinePlanError(UNSUPPORTED)
  }

  const resources: OfflineResource[] = []
  const out: string[] = []
  let pendingDuration: number | null = null
  let totalDurationSec = 0
  let segmentCount = 0
  let keyCount = 0
  let initCount = 0
  let ended = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      out.push(raw)
      continue
    }

    if (line.startsWith("#")) {
      // A master playlist (variants) or byte-range segments are not what the
      // server emits for offline use; refuse instead of storing half a video.
      if (
        line.startsWith("#EXT-X-STREAM-INF") ||
        line.startsWith("#EXT-X-BYTERANGE")
      ) {
        throw new OfflinePlanError(UNSUPPORTED)
      }
      if (line.startsWith("#EXTINF:")) {
        const duration = parseFloat(line.slice("#EXTINF:".length))
        if (!Number.isFinite(duration) || duration < 0) {
          throw new OfflinePlanError(UNSUPPORTED)
        }
        pendingDuration = duration
      } else if (line === "#EXT-X-ENDLIST") {
        ended = true
      } else if (
        line.startsWith("#EXT-X-KEY:") ||
        line.startsWith("#EXT-X-MAP:")
      ) {
        // Encryption keys and init sections are files too: fetch them and
        // point the playlist's URI="…" attribute at the local copy.
        const isKey = line.startsWith("#EXT-X-KEY:")
        const uri = /URI="([^"]*)"/.exec(line)?.[1]
        if (isKey && (uri === undefined || /METHOD=NONE/.test(line))) {
          out.push(raw)
          continue
        }
        if (uri === undefined || !isAbsoluteHttp(uri)) {
          throw new OfflinePlanError(UNSUPPORTED)
        }
        const localPath = isKey
          ? `key/${pad(keyCount++)}.key`
          : `init/${pad(initCount++)}.${extensionOf(uri, "mp4")}`
        resources.push({
          kind: isKey ? "key" : "init",
          remoteUrl: uri,
          localPath,
          durationSec: 0,
        })
        out.push(line.replace(/URI="[^"]*"/, `URI="${localBase}${localPath}"`))
        continue
      }
      out.push(raw)
      continue
    }

    // A URI line: the segment the preceding #EXTINF describes.
    if (pendingDuration === null || !isAbsoluteHttp(line)) {
      throw new OfflinePlanError(UNSUPPORTED)
    }
    const localPath = `seg/${pad(segmentCount)}.${extensionOf(line, "ts")}`
    resources.push({
      kind: "segment",
      remoteUrl: line,
      localPath,
      durationSec: pendingDuration,
    })
    out.push(`${localBase}${localPath}`)
    totalDurationSec += pendingDuration
    segmentCount += 1
    pendingDuration = null
  }

  // Without ENDLIST it's a live/event playlist — nothing finite to download.
  if (!ended || segmentCount === 0) {
    throw new OfflinePlanError(UNSUPPORTED)
  }

  return {
    resources,
    segmentCount,
    totalDurationSec,
    fingerprint: `${segmentCount}:${Math.round(totalDurationSec * 1000)}:${keyCount}:${initCount}`,
    playlist: out.join("\n"),
  }
}
