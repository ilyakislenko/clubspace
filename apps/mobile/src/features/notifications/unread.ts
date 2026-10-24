// The inbox is fetched in pages of 50, so the badge counts within that page —
// "99+" only guards the display if the page size ever grows.
export const countUnread = (items: readonly { seen: boolean }[]): number =>
  items.filter((n) => !n.seen).length

/** Badge text: nothing for zero, «99+» past two digits. */
export const formatBadge = (count: number): string | null =>
  count <= 0 ? null : count > 99 ? "99+" : String(count)
