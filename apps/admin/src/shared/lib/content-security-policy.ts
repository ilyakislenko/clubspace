// The Content-Security-Policy of every page, built per request by src/proxy.ts.
//
// Scripts run only with the request's nonce: Next stamps it on its own scripts
// (it reads it back from this header) and the root layout passes it to the
// inline theme script; 'strict-dynamic' lets those load their chunks. Styles
// keep 'unsafe-inline' — React style props and the player set inline styles,
// and a style cannot run code. Everything else the page talks to is listed by
// origin: the API (HTTPS plus the socket.io WebSocket), object storage
// (thumbnails, HLS segments, presigned uploads) and the Sentry ingest when a
// DSN is baked in. Same algorithm as
// apps/client/src/shared/lib/content-security-policy.ts — keep the two in step.

type Env = Record<string, string | undefined>

export type CspSources = {
  nonce: string
  // `next dev`: React rebuilds server error stacks with eval.
  dev: boolean
  apiUrl: string
  // Object storage as browsers reach it; null/blank entries are skipped.
  mediaUrls: Array<string | null | undefined>
  sentryDsn?: string | null
}

const originOf = (url: string | null | undefined): string | null => {
  const raw = url?.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null
  } catch {
    return null
  }
}

const present = (values: Array<string | null | undefined | false>): string[] => [
  ...new Set(values.filter((v): v is string => Boolean(v))),
]

// Where presigned object URLs point: the server signs them for
// S3_ACCELERATE_URL when set, S3_UPLOAD_BUCKET_URL otherwise (both are passed
// to this container at runtime, like the server's own).
export const readMediaUrls = (env: Env = process.env): string[] =>
  present([env.S3_UPLOAD_BUCKET_URL, env.S3_ACCELERATE_URL])

export const buildContentSecurityPolicy = (s: CspSources): string => {
  const api = originOf(s.apiUrl)
  const media = present(s.mediaUrls.map(originOf))
  const sentry = originOf(s.sentryDsn)

  const directives: Array<[string, Array<string | null | undefined | false>]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${s.nonce}'`, "'strict-dynamic'", s.dev && "'unsafe-eval'"],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...media]],
    // HLS playlists come from the API (ROOT_URL), their segments from storage.
    ["media-src", ["'self'", "blob:", api, ...media]],
    ["font-src", ["'self'", "data:"]],
    // http://api.x → ws://api.x, https://api.x → wss://api.x (socket.io).
    ["connect-src", ["'self'", api, api?.replace(/^http/, "ws"), ...media, sentry]],
    // hls.js runs its demuxer in a blob: worker.
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ]

  return directives
    .map(([name, values]) => [name, ...present(values)].join(" "))
    .join("; ")
}
