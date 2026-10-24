// Material window size classes. Pure (no react-native import) so jest can
// cover it. Kept apart from the BP_* breakpoints in `useResponsive`, which the
// web desktop logic depends on: a tablet is "medium" in portrait and
// "expanded" in landscape, and a phone is always "compact".
export const SIZE_MEDIUM = 600
export const SIZE_EXPANDED = 960

export type SizeClass = "compact" | "medium" | "expanded"

export type ColumnsBySizeClass = Partial<Record<SizeClass, number>>

const DEFAULT_COLUMNS: Record<SizeClass, number> = {
  compact: 1,
  medium: 2,
  expanded: 3,
}

// Horizontal page padding and the gap between grid cells, per size class.
export const PAGE_PADDING: Record<SizeClass, number> = {
  compact: 16,
  medium: 24,
  expanded: 32,
}
export const GRID_GAP: Record<SizeClass, number> = {
  compact: 12,
  medium: 16,
  expanded: 20,
}

export const sizeClassFor = (width: number): SizeClass =>
  width >= SIZE_EXPANDED
    ? "expanded"
    : width >= SIZE_MEDIUM
      ? "medium"
      : "compact"

export const columnsFor = (
  sizeClass: SizeClass,
  cols?: ColumnsBySizeClass,
): number => Math.max(1, cols?.[sizeClass] ?? DEFAULT_COLUMNS[sizeClass])

// Headings step up on larger windows; compact keeps the theme's own size.
export const TABLET_TEXT_STEP = 4
export const steppedFontSize = (
  sizeClass: SizeClass,
  fontSize: number,
  step = TABLET_TEXT_STEP,
): number => (sizeClass === "compact" ? fontSize : fontSize + step)
