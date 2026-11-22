// «Поделиться моментом»: a link that opens a lesson at a second (and loops an
// A–B segment), and the text it is shared with. The link is the Video
// screen's own path, `video/<id>?startAt=…&loopEndAt=…` — the web build's
// linking config (app/linking.ts) maps those query params straight onto the
// route's params; the native app reads the same URL itself (pending-moment).
// Pure, so build and parse are unit-tested. (No URLSearchParams: React
// Native's is incomplete.)
import { formatPosition } from "./format-position"

export type MomentLink = {
  videoId: string
  // Seconds; absent = the lesson from its usual start.
  startAt?: number
  // Set = an A–B segment from startAt to here, looped.
  loopEndAt?: number
}

// What a share action hands the screen: a moment (or segment) of the lesson
// on screen, with the name it is shared under.
export type SharedMoment = {
  startSec: number
  endSec?: number | null
  label?: string | null
}

const VIDEO_PATH = /(?:^[a-z][a-z0-9+.-]*:\/\/|\/)video\/([A-Za-z0-9-]{1,64})(?=$|[/?#])/i

const seconds = (raw: string | undefined): number | undefined => {
  if (raw == null || raw.trim() === "") return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

// `a=1&b=2` (after the `?`, before any `#`) as a lookup.
const queryOf = (url: string, from: number): Record<string, string> => {
  const start = url.indexOf("?", from)
  if (start < 0) return {}
  const query: Record<string, string> = {}
  for (const pair of url.slice(start + 1).split("#")[0].split("&")) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    try {
      query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1))
    } catch {
      // A malformed escape: that pair is ignored.
    }
  }
  return query
}

/**
 * The link for a moment (`endSec` set = a segment) under `base`: a web origin
 * (`https://app.club`, trailing slashes ignored) or an app scheme root
 * (`clubspace://`). Whole seconds: the start rounds down, the end up.
 */
export const buildMomentLink = (
  base: string,
  moment: { videoId: string; startSec: number; endSec?: number | null },
): string => {
  const root = base.endsWith("://") ? base : `${base.replace(/\/+$/, "")}/`
  const startAt = Math.max(0, Math.floor(moment.startSec))
  const end = moment.endSec != null ? Math.ceil(moment.endSec) : null
  const loop = end != null && end > startAt ? `&loopEndAt=${end}` : ""
  return `${root}video/${encodeURIComponent(moment.videoId)}?startAt=${startAt}${loop}`
}

/** The moment in a shared link, or null when the URL isn't a lesson link. */
export const parseMomentLink = (url: string): MomentLink | null => {
  const match = VIDEO_PATH.exec(url)
  if (!match) return null
  const query = queryOf(url, match.index)
  const startAt = seconds(query.startAt)
  const end = seconds(query.loopEndAt)
  return {
    videoId: match[1],
    ...(startAt !== undefined && { startAt }),
    ...(startAt !== undefined && end !== undefined && end > startAt && { loopEndAt: end }),
  }
}

/** «Урок — 3:41 «Название»» (a segment: «3:41–4:05»), then the link. */
export const momentShareText = (moment: {
  videoTitle: string
  startSec: number
  endSec?: number | null
  label?: string | null
  url: string
}): string => {
  const time =
    moment.endSec != null
      ? `${formatPosition(moment.startSec)}–${formatPosition(moment.endSec)}`
      : formatPosition(moment.startSec)
  const label = moment.label?.trim()
  return `${moment.videoTitle} — ${time}${label ? ` «${label}»` : ""}\n${moment.url}`
}
