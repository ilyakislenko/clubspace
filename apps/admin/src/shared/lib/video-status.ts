// Single source of truth for presenting the backend's Video.status values in the
// admin UI, so no screen shows raw enum strings (e.g. "processing") to users.

const STATUS_META: Record<string, { label: string; badgeClass: string }> = {
  uploading: {
    label: "Загружается",
    badgeClass: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  uploaded: {
    label: "Загружено",
    badgeClass: "bg-sky-50 text-sky-700 ring-sky-600/20",
  },
  queued: {
    label: "В очереди",
    badgeClass: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  processing: {
    label: "Обработка",
    badgeClass: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  ready: {
    label: "Готово",
    badgeClass: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  failed: {
    label: "Ошибка",
    badgeClass: "bg-red-50 text-red-700 ring-red-600/20",
  },
}

const FALLBACK_BADGE_CLASS = "bg-zinc-100 text-zinc-700 ring-zinc-600/20"

export const videoStatusLabel = (status: string): string =>
  STATUS_META[status]?.label ?? status

export const videoStatusBadgeClass = (status: string): string =>
  STATUS_META[status]?.badgeClass ?? FALLBACK_BADGE_CLASS

// True while the video is still being ingested/transcoded and therefore has no
// playable HLS yet — the playback endpoint legitimately 400s in this window.
export const isVideoProcessing = (status: string): boolean =>
  status === "uploading" ||
  status === "uploaded" ||
  status === "queued" ||
  status === "processing"
