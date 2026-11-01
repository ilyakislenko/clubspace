// Sizing a download before committing to it. The offline manifest lists
// segment durations, not sizes, so the total is extrapolated from the bytes per
// second of what's already been fetched, then checked against what the browser
// says the origin may still use (navigator.storage.estimate()).

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`
}

// Bitrate varies across a lesson (a static wall vs. a scramble), so the
// extrapolation is padded rather than trusted to the byte.
const ESTIMATE_PADDING = 1.15

/**
 * Projects the full download size from a sample.
 * @param sampledBytes bytes fetched so far
 * @param sampledDurationSec media seconds those bytes cover
 * @param totalDurationSec media seconds of the whole rendition
 */
export const estimateTotalBytes = (p: {
  sampledBytes: number
  sampledDurationSec: number
  totalDurationSec: number
}): number => {
  if (p.sampledDurationSec <= 0 || p.totalDurationSec <= 0) return p.sampledBytes
  const projected =
    (p.sampledBytes / p.sampledDurationSec) * p.totalDurationSec * ESTIMATE_PADDING
  return Math.max(p.sampledBytes, Math.ceil(projected))
}

// Never fill the origin to the brim: the app shell, API snapshots and the
// next deploy's bundle need room too, and a browser near its quota evicts.
const MIN_HEADROOM_BYTES = 50 * 1024 * 1024
const HEADROOM_RATIO = 0.1

export type StorageBudget =
  | { ok: true; freeBytes: number | null }
  | { ok: false; freeBytes: number; requiredBytes: number }

/**
 * @param quota/usage from navigator.storage.estimate(); undefined when the
 *   browser doesn't report them (then the write itself is the check)
 * @param remainingBytes what the download still has to store
 */
export const checkStorageBudget = (p: {
  quota: number | undefined
  usage: number | undefined
  remainingBytes: number
}): StorageBudget => {
  if (p.quota === undefined || p.usage === undefined) {
    return { ok: true, freeBytes: null }
  }
  const headroom = Math.max(MIN_HEADROOM_BYTES, p.quota * HEADROOM_RATIO)
  const freeBytes = Math.max(0, p.quota - p.usage - headroom)
  return p.remainingBytes <= freeBytes
    ? { ok: true, freeBytes }
    : { ok: false, freeBytes, requiredBytes: p.remainingBytes }
}

export const notEnoughSpaceMessage = (p: {
  requiredBytes: number
  freeBytes: number
}): string =>
  `Недостаточно места: для урока нужно ещё ~${formatBytes(p.requiredBytes)}, ` +
  `а браузер разрешает занять ~${formatBytes(p.freeBytes)}. ` +
  "Удалите другие загрузки и попробуйте снова."
