import { buildCourseVisibilityClauses } from './playlist-visibility'

describe('buildCourseVisibilityClauses', () => {
    it('returns empty clauses when staff scope sees everything', () => {
        expect(
            buildCourseVisibilityClauses({ includeUnpublished: true }),
        ).toEqual([])
    })

    it('scopes students to courses whose publish date has arrived', () => {
        const now = new Date('2026-05-08T12:00:00Z')
        // YouTube-style: visible iff publishedAt <= now. `lte` excludes null
        // (draft) and future (scheduled), so a single clause suffices.
        expect(buildCourseVisibilityClauses({ now })).toEqual([
            { publishedAt: { lte: now } },
        ])
    })

    it('treats includeUnpublished=false the same as omitting it', () => {
        const now = new Date('2026-05-08T12:00:00Z')
        expect(
            buildCourseVisibilityClauses({
                includeUnpublished: false,
                now,
            }),
        ).toEqual(buildCourseVisibilityClauses({ now }))
    })
})
