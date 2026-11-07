// Formats a playback position (seconds) as `h:mm:ss`, or `m:ss` under an hour.
// Floors to whole seconds and clamps negatives to zero. Shared by the video
// study tools and the A/B loop controls so the two stay in lockstep.
//
// Note: this is deliberately separate from drill-context's `formatClock`, which
// is a *countdown* (it ceils, and never shows hours) — a different contract.
export const formatPosition = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// A bookmark's time chip: «1:12», or «1:12–1:25 ⟲» for a saved A–B segment.
export const formatBookmarkTime = (b: {
  positionSec: number
  endSec: number | null
}): string =>
  b.endSec != null
    ? `${formatPosition(b.positionSec)}–${formatPosition(b.endSec)} ⟲`
    : formatPosition(b.positionSec)

// What tapping a bookmark does, for screen readers: loop a segment, show the
// drawing on its paused frame, or seek to its moment.
export const bookmarkOpenLabel = (b: {
  positionSec: number
  endSec: number | null
  label: string
  drawing?: unknown
}): string => {
  const name = b.label ? `, ${b.label}` : ""
  if (b.endSec != null) {
    return `Повторять отрезок ${formatPosition(b.positionSec)}–${formatPosition(b.endSec)}${name}`
  }
  return b.drawing
    ? `Показать рисунок на ${formatPosition(b.positionSec)}${name}`
    : `Перейти к ${formatPosition(b.positionSec)}${name}`
}
