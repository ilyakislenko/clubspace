// A plan holds at most this many items (a long playlist, not a library).
export const MAX_STUDY_PLAN_ITEMS = 200

/** A moment (no end) or a segment whose end is after its start. */
export const isValidItemRange = (startSec: number, endSec: number | null): boolean =>
    endSec === null || endSec > startSec

/**
 * Whether `requested` lists exactly the plan's current items, each once — a
 * reorder made against a stale copy (an item added or removed meanwhile) must
 * not silently drop or duplicate anything.
 */
export const isSameItemSet = (
    current: readonly string[],
    requested: readonly string[],
): boolean => {
    if (current.length !== requested.length) return false
    const pending = new Set(current)
    for (const id of requested) {
        if (!pending.delete(id)) return false
    }
    return true
}
