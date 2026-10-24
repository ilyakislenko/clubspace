type Ordered = { id: string; order: number }

// `order` is unique per ladder, so after deleting a middle level
// `levels.length` can collide with an existing order — use max + 1.
export const nextLevelOrder = (levels: Ordered[]): number =>
  levels.length === 0 ? 0 : Math.max(...levels.map((l) => l.order)) + 1

// Ordered PATCH steps that swap level `index` with its neighbour. The unique
// (ladderId, order) constraint forbids writing a taken order, so the first
// step parks the moved level on a free temporary order.
export const swapSteps = (
  levels: Ordered[],
  index: number,
  direction: -1 | 1,
): { levelId: string; order: number }[] | null => {
  const a = levels[index]
  const b = levels[index + direction]
  if (!a || !b) return null
  return [
    { levelId: a.id, order: nextLevelOrder(levels) },
    { levelId: b.id, order: a.order },
    { levelId: a.id, order: b.order },
  ]
}
