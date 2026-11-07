/** `ids` with the one at `index` moved by `delta` places (clamped); a copy. */
export const moveId = (ids: readonly string[], index: number, delta: number): string[] => {
  const next = [...ids]
  const target = Math.max(0, Math.min(ids.length - 1, index + delta))
  if (index < 0 || index >= ids.length || target === index) return next
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}
