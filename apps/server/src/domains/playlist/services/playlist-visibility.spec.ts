import { buildCourseVisibilityClauses } from './playlist-visibility'

describe('buildCourseVisibilityClauses', () => {
    it('returns empty clauses when staff scope sees everything', () => {
        expect(
            buildCourseVisibilityClauses({ includeUnpublished: true }),
        ).toEqual([])
    })

    it('returns isPublic + publishedAt-OR pair for student scope', () => {
        const now = new Date('2026-05-08T12:00:00Z')
        expect(buildCourseVisibilityClauses({ now })).toEqual([
            { isPublic: true },
            {
                OR: [
                    { publishedAt: null },
                    { publishedAt: { lte: now } },
                ],
            },
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
