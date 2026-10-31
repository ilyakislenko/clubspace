import { afterCursor, collectPages } from './export-my-data-utils'

// A fake table of `n` rows served page by page from an id cursor.
const table = (n: number) => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))
    const fetchPage = jest.fn(async (cursor: string | undefined, take: number) => {
        const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0
        return rows.slice(start, start + take)
    })
    return { rows, fetchPage }
}

describe('collectPages', () => {
    it('reads every page of a section below the cap', async () => {
        const { rows, fetchPage } = table(25)
        const out = await collectPages(fetchPage, 100, 10)
        expect(out).toEqual({ rows, truncated: false })
        expect(fetchPage.mock.calls).toEqual([
            [undefined, 10],
            ['r9', 10],
            ['r19', 10],
        ])
    })

    it('returns an empty, untruncated section', async () => {
        const { fetchPage } = table(0)
        await expect(collectPages(fetchPage, 100, 10)).resolves.toEqual({
            rows: [],
            truncated: false,
        })
    })

    it('reports exactly-cap rows as complete', async () => {
        const { rows, fetchPage } = table(20)
        const out = await collectPages(fetchPage, 20, 10)
        expect(out).toEqual({ rows, truncated: false })
    })

    it('cuts at the cap and flags the section, keeping the oldest rows', async () => {
        const { rows, fetchPage } = table(50)
        const out = await collectPages(fetchPage, 20, 10)
        expect(out.truncated).toBe(true)
        expect(out.rows).toEqual(rows.slice(0, 20))
        // Never reads more than one row past the cap.
        const read = fetchPage.mock.calls.reduce((n, [, take]) => n + take, 0)
        expect(read).toBe(21)
    })
})

describe('afterCursor', () => {
    it('is empty for the first page and skips the cursor row after it', () => {
        expect(afterCursor(undefined)).toEqual({})
        expect(afterCursor('r9')).toEqual({ cursor: { id: 'r9' }, skip: 1 })
    })
})
