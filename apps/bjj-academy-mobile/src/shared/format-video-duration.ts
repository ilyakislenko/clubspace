// Formats a video duration (seconds) as "m:ss", or null when there's no usable
// duration. Distinct from features/video/format-position (a *playback position*:
// h:mm:ss, never null).
export const formatVideoDuration = (
  seconds?: number | null,
): string | null => {
  if (!seconds || seconds <= 0) return null
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes}:${secs.toString().padStart(2, "0")}`
}
