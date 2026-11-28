// The «Видеоинструкции» page (/help): task-based video guides recorded by
// scripts/guides (docs/guides.md) and published with a manifest next to the
// files, `${GUIDES_BASE_URL}/guides.json`. Read at request time, like the
// rest of this host's runtime config: new guides need an upload, no deploy.

type Env = Record<string, string | undefined>

export type Guide = {
  id: string
  // Who the guide is for; also the group heading on the page.
  role: string
  title: string
  // Absolute URLs (relative names in the manifest resolve against the base).
  file: string
  poster: string | null
  durationSec: number | null
}

export type GuideGroup = { role: string; guides: Guide[] }

// Where the manifest and the files live; null while not configured.
export const readGuidesBaseUrl = (env: Env = process.env): string | null => {
  const v = env.GUIDES_BASE_URL?.trim().replace(/\/+$/, "")
  return v ? v : null
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null

// A manifest name is either a full http(s) URL or a file name next to it.
const resolve = (name: string, base: string): string | null => {
  try {
    const url = new URL(name, `${base}/`)
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

// The guides of a fetched manifest, in manifest order. Entries without an id,
// role, title or a usable file are dropped rather than failing the page; a
// manifest that is not an array has no guides.
export const parseGuidesManifest = (raw: unknown, base: string): Guide[] => {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const guides: Guide[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const id = text(e.id)
    const role = text(e.role)
    const title = text(e.title)
    const fileName = text(e.file)
    const file = fileName && resolve(fileName, base)
    if (!id || !role || !title || !file || seen.has(id)) continue
    seen.add(id)
    const posterName = text(e.poster)
    const duration = e.durationSec
    guides.push({
      id,
      role,
      title,
      file,
      poster: posterName ? resolve(posterName, base) : null,
      durationSec:
        typeof duration === "number" && Number.isFinite(duration) && duration > 0
          ? Math.round(duration)
          : null,
    })
  }
  return guides
}

// Guides grouped by role; groups in the order their first guide appears.
export const groupGuidesByRole = (guides: Guide[]): GuideGroup[] => {
  const groups = new Map<string, Guide[]>()
  for (const g of guides) {
    const list = groups.get(g.role)
    if (list) list.push(g)
    else groups.set(g.role, [g])
  }
  return [...groups].map(([role, list]) => ({ role, guides: list }))
}

// 75 → "1:15".
export const formatGuideDuration = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`
