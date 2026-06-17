/**
 * Pure ordering math shared by the playlist video- and chapter-reorder paths.
 *
 * Given the current order of ids and a move anchored to a neighbour
 * (`afterId`/`beforeId`) — or to an end via an explicit `null` — it returns
 * the new id order. Callers own the DB read/write and neighbour validation;
 * isolating the array shuffle here keeps the two reorder features from drifting
 * and makes the (previously DB-bound, untestable) logic unit-testable.
 *
 * Resolution order mirrors the original inline implementations exactly:
 *   afterId === null  -> move to the front
 *   beforeId === null -> move to the end
 *   afterId set       -> directly after that neighbour
 *   beforeId set      -> directly before that neighbour
 *   otherwise         -> end
 * A neighbour id not present resolves via indexOf(-1), matching prior behaviour
 * (front for `afterId`, end for `beforeId`); callers validate when they care.
 */
export function reorderIds(
    orderedIds: string[],
    movingId: string,
    opts: { afterId?: string | null; beforeId?: string | null },
): string[] {
    const without = orderedIds.filter((id) => id !== movingId)

    let insertAt: number
    if (opts.afterId === null) {
        insertAt = 0
    } else if (opts.beforeId === null) {
        insertAt = without.length
    } else if (opts.afterId) {
        insertAt = without.indexOf(opts.afterId) + 1
    } else if (opts.beforeId) {
        insertAt = without.indexOf(opts.beforeId)
    } else {
        insertAt = without.length
    }

    return [...without.slice(0, insertAt), movingId, ...without.slice(insertAt)]
}
