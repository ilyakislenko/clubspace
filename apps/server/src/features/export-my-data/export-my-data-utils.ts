// Rows per query while assembling the export: keeps each round-trip and its
// result set small instead of one unbounded findMany per section.
export const EXPORT_PAGE_SIZE = 1000

// Rows per section in one file. Years of daily training stay far below it;
// it exists so a pathological account can't build an unbounded response.
export const EXPORT_SECTION_CAP = 10_000

/**
 * Reads a section page by page with an id cursor until it is exhausted or the
 * cap is reached. `fetchPage` must order by a stable key ending in `id`.
 * Reads one row past the cap to tell "exactly cap rows" from "cut".
 */
export const collectPages = async <T extends { id: string }>(
    fetchPage: (cursor: string | undefined, take: number) => Promise<T[]>,
    cap: number = EXPORT_SECTION_CAP,
    pageSize: number = EXPORT_PAGE_SIZE,
): Promise<{ rows: T[]; truncated: boolean }> => {
    const rows: T[] = []
    let cursor: string | undefined
    for (;;) {
        const take = Math.min(pageSize, cap + 1 - rows.length)
        const page = await fetchPage(cursor, take)
        rows.push(...page)
        if (rows.length > cap) {
            return { rows: rows.slice(0, cap), truncated: true }
        }
        if (page.length < take) {
            return { rows, truncated: false }
        }
        cursor = page[page.length - 1].id
    }
}

/** Prisma cursor args for the page after `cursor` (none for the first). */
export const afterCursor = (
    cursor: string | undefined,
): { cursor?: { id: string }; skip?: number } =>
    cursor ? { cursor: { id: cursor }, skip: 1 } : {}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10)

export const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null)
