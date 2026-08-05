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
