import {
    buildSnippet,
    likePattern,
    MAX_MOMENTS_PER_VIDEO,
    pickMoments,
    rankVideoHits,
    type VideoHitRow,
} from './search-videos-utils'

const row = (id: string, over: Partial<VideoHitRow> = {}): VideoHitRow => ({
    id,
    title: `Video ${id}`,
    thumbnailUrl: null,
    duration: 100,
    titleHit: false,
    chapterHits: 0,
    chapterMoments: null,
    speechHits: 0,
    speechMoments: null,
    speechRuHits: 0,
    speechRuMoments: null,
    ...over,
})

describe('likePattern', () => {
    it('wraps the query and escapes LIKE wildcards and the escape char', () => {
        expect(likePattern('guard')).toBe('%guard%')
        expect(likePattern('50%_off\\x')).toBe('%50\\%\\_off\\\\x%')
    })
})

describe('buildSnippet', () => {
    const long =
        'First we settle the grips and then we break the posture of the opponent, ' +
        'and only after that we look for the kimura from the closed guard position ' +
        'while keeping the hips active and the elbow tight to the body.'

    it('cuts around the hit at word boundaries and points at it', () => {
        const { snippet, highlight } = buildSnippet(long, 'KIMURA')
        expect(snippet.startsWith('…')).toBe(true)
        expect(snippet.endsWith('…')).toBe(true)
        expect(snippet.length).toBeLessThanOrEqual(6 + 40 * 2 + 20)
        expect(snippet.slice(highlight!.start, highlight!.start + highlight!.length)).toBe(
            'kimura',
        )
        // No word is chopped.
        expect(snippet).toMatch(/^… ?\S/)
        expect(long).toContain(snippet.slice(1, -1).trim())
    })

    it('keeps a short text whole', () => {
        expect(buildSnippet('  Захват   за рукав ', 'рукав')).toEqual({
            snippet: 'Захват за рукав',
            highlight: { start: 10, length: 5 },
        })
    })

    it('matches Cyrillic case-insensitively', () => {
        expect(buildSnippet('Кимура из гарда', 'КИМУРА').highlight).toEqual({
            start: 0,
            length: 6,
        })
    })

    it('falls back to the start, unhighlighted, when the hit is not found', () => {
        const res = buildSnippet(long, 'ёлка')
        expect(res.highlight).toBeNull()
        expect(res.snippet.endsWith('…')).toBe(true)
        expect(long.startsWith(res.snippet.slice(0, -1))).toBe(true)
    })
})

describe('rankVideoHits', () => {
    it('puts title hits, then chapter hits, then the most speech first', () => {
        const ranked = rankVideoHits([
            row('speech3', { speechHits: 2, speechRuHits: 1 }),
            row('chapter', { chapterHits: 1 }),
            row('speech5', { speechHits: 5 }),
            row('title', { titleHit: true }),
            row('both', { titleHit: true, chapterHits: 2 }),
        ])
        expect(ranked.map((r) => r.id)).toEqual([
            'both',
            'title',
            'chapter',
            'speech5',
            'speech3',
        ])
    })

    it('breaks ties by title', () => {
        const ranked = rankVideoHits([
            row('b', { title: 'Ясно', speechHits: 1 }),
            row('a', { title: 'Армбар', speechHits: 1 }),
        ])
        expect(ranked.map((r) => r.id)).toEqual(['a', 'b'])
    })
})

describe('pickMoments', () => {
    it('merges chapters, speech and translation in time order', () => {
        const moments = pickMoments(
            row('v', {
                chapterMoments: [{ at: 120, text: 'Kimura setup' }],
                speechMoments: [{ at: 30.7, text: 'the kimura grip' }],
                speechRuMoments: [
                    { at: 30.2, text: 'хват кимура' },
                    { at: 300, text: 'снова кимура' },
                ],
            }),
            'kimura',
        )
        expect(moments.map((m) => [m.atSec, m.kind])).toEqual([
            [30, 'speech'],
            [120, 'chapter'],
            [300, 'speechRu'],
        ])
        expect(moments[0]).toMatchObject({
            snippet: 'the kimura grip',
            highlight: { start: 4, length: 6 },
        })
    })

    it(`keeps at most ${MAX_MOMENTS_PER_VIDEO}, chapters first`, () => {
        const many = Array.from({ length: 6 }, (_, i) => ({ at: i, text: 'kimura' }))
        const moments = pickMoments(
            row('v', {
                chapterMoments: [{ at: 99, text: 'Kimura' }],
                speechMoments: many,
            }),
            'kimura',
        )
        expect(moments).toHaveLength(MAX_MOMENTS_PER_VIDEO)
        expect(moments.some((m) => m.kind === 'chapter')).toBe(true)
    })

    it('copes with no moments at all (a title-only hit)', () => {
        expect(pickMoments(row('v', { titleHit: true }), 'x')).toEqual([])
    })
})
