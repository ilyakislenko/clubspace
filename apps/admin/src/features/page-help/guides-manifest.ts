import { cachedRead } from "../../shared/api/read-cache"
import { isGuideId, type GuideId } from "./help-entries"

// The video guides published next to the app: `${base}/guides.json` lists
// `{ id, role, title, file, poster, durationSec }`, file and poster relative
// to the base. Read once per session, when a «?» panel first opens.

export type Guide = {
  id: GuideId
  title: string
  videoUrl: string
  posterUrl: string | null
  // null when the manifest gives no usable length.
  durationSec: number | null
}

const resolveUrl = (value: unknown, baseUrl: string): string | null => {
  if (typeof value !== "string" || !value.trim()) return null
  try {
    const url = new URL(value.trim(), `${baseUrl}/`)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}

// Guides by id. Entries with an unknown id, no title or no playable file are
// skipped; the first entry of an id wins. Anything but an array is no guides.
export const parseGuidesManifest = (raw: unknown, baseUrl: string): Map<GuideId, Guide> => {
  const guides = new Map<GuideId, Guide>()
  if (!Array.isArray(raw)) return guides
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const { id, title, file, poster, durationSec } = item as Record<string, unknown>
    if (!isGuideId(id) || guides.has(id)) continue
    const videoUrl = resolveUrl(file, baseUrl)
    if (typeof title !== "string" || !title.trim() || !videoUrl) continue
    guides.set(id, {
      id,
      title: title.trim(),
      videoUrl,
      posterUrl: resolveUrl(poster, baseUrl),
      durationSec:
        typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
          ? Math.round(durationSec)
          : null,
    })
  }
  return guides
}

// «4:05».
export const formatGuideDuration = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

const SESSION_MS = 12 * 60 * 60 * 1000

// The published guides; rejects when the manifest can't be fetched or read
// (the caller shows text only). Failures are not kept, so the next panel
// opened asks again.
export const loadGuides = (baseUrl: string): Promise<Map<GuideId, Guide>> =>
  cachedRead(
    `page-help-guides:${baseUrl}`,
    async () => {
      const response = await fetch(`${baseUrl}/guides.json`)
      if (!response.ok) throw new Error(`guides.json: HTTP ${response.status}`)
      return parseGuidesManifest(await response.json(), baseUrl)
    },
    SESSION_MS,
  )
