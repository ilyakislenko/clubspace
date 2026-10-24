// The scroll offset at which a field whose bottom edge is at `fieldBottom`
// (in the scroll view's *content* coordinates) sits `margin` above the bottom
// of a `viewportHeight`-tall viewport — or null when it is already visible at
// `currentOffset`. Content coordinates don't depend on how far the view has
// scrolled, so the answer can't be skewed by a scroll still in flight.
export const revealScrollOffset = (
  fieldBottom: number,
  viewportHeight: number,
  currentOffset: number,
  margin = 16,
): number | null => {
  const needed = Math.ceil(fieldBottom + margin - viewportHeight)
  return needed > currentOffset ? needed : null
}
