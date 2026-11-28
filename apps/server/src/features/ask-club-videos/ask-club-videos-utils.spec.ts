import {
    buildAnswerMessages,
    buildExcerpt,
    buildSearchTerms,
    excerptCues,
    glossaryVariants,
    MAX_EXCERPTS,
    MAX_SEARCH_TERMS,
    type MomentHitRow,
    parseAnswer,
    parseExpansionTerms,
    pickMoments,
    questionWords,
    searchStem,
    termPatterns,
} from './ask-club-videos-utils'

const hit = (over: Partial<MomentHitRow> = {}): MomentHitRow => ({
    videoId: 'v1',
    title: 'Выходы',
    kind: 'speech',
    at: 100,
    text: 'выход из маунта',
    score: 1,
    titleScore: 0,
    ...over,
})

describe('search terms', () => {
    it('stems a long Russian word, keeps short and Latin ones', () => {
        expect(searchStem('маунта')).toBe('маунт')
        expect(searchStem('голову')).toBe('голов')
        expect(searchStem('гард')).toBe('гард')
        expect(searchStem('Mount')).toBe('mount')
    })

    it("reads the model's JSON, tolerating a fence around it, and nothing else", () => {
        expect(parseExpansionTerms('```json\n{"terms": ["маунт", 3, "mount"]}\n```')).toEqual(['маунт', 'mount'])
        expect(parseExpansionTerms('не JSON')).toEqual([])
        expect(parseExpansionTerms('{"words": ["x"]}')).toEqual([])
        expect(parseExpansionTerms('{broken')).toEqual([])
    })

    it('falls back to the meaningful words of the question', () => {
        expect(questionWords('Как выйти из маунта, если держат голову?')).toEqual(['выйти', 'маунта', 'держат', 'голову'])
    })

    it('adds the glossary names of the technique asked about', () => {
        const variants = glossaryVariants(['как выйти из маунта'], 'GRAPPLING')
        expect(variants).toEqual(expect.arrayContaining(['mount', 'маунт']))
        expect(glossaryVariants(['kimura from guard'], 'GRAPPLING')).toEqual(
            expect.arrayContaining(['Kimura', 'кимура']),
        )
        // A sport without a glossary adds nothing.
        expect(glossaryVariants(['маунт'], 'CUSTOM')).toEqual([])
    })

    it("puts the model's terms first, dedupes, drops too-short ones and caps the list", () => {
        const terms = buildSearchTerms({
            question: 'как выйти из маунта?',
            expanded: ['Маунта', 'маунт', 'ги', 'escape the mount'],
            sport: 'GRAPPLING',
        })
        expect(terms[0]).toBe('маунт')
        expect(terms).toContain('escape the mount')
        expect(terms).toContain('mount')
        expect(terms).not.toContain('ги')
        expect(new Set(terms).size).toBe(terms.length)
        const many = buildSearchTerms({
            question: 'x',
            expanded: Array.from({ length: 40 }, (_, i) => `термин${i}`),
            sport: 'CUSTOM',
        })
        expect(many).toHaveLength(MAX_SEARCH_TERMS)
    })

    it("escapes the member's LIKE wildcards", () => {
        expect(termPatterns(['50%_x'])).toEqual(['%50\\%\\_x%'])
    })
})

describe('pickMoments', () => {
    it('never takes a video outside the watchable set', () => {
        const picked = pickMoments(
            [hit({ videoId: 'locked', score: 5 }), hit({ videoId: 'v1', score: 1 })],
            new Set(['v1']),
        )
        expect(picked.map((m) => m.videoId)).toEqual(['v1'])
    })

    it('takes the best first, one per minute of a video, two per video, six in all', () => {
        const rows = [
            hit({ at: 10, score: 1 }),
            hit({ at: 30, score: 3 }),
            hit({ at: 200, score: 2 }),
            hit({ at: 400, score: 2 }),
            ...Array.from({ length: 10 }, (_, i) => hit({ videoId: `w${i}`, at: 5, score: 1 })),
        ]
        const picked = pickMoments(rows, new Set(['v1', ...Array.from({ length: 10 }, (_, i) => `w${i}`)]))
        expect(picked).toHaveLength(MAX_EXCERPTS)
        expect(picked.slice(0, 2).map((m) => [m.videoId, m.at])).toEqual([
            ['v1', 30],
            ['v1', 200],
        ])
        expect(picked.filter((m) => m.videoId === 'v1')).toHaveLength(2)
    })

    it('a title naming the terms and a chapter title rank a moment higher', () => {
        const picked = pickMoments(
            [hit({ videoId: 'a', score: 1 }), hit({ videoId: 'b', score: 1, titleScore: 1 }), hit({ videoId: 'c', score: 1, kind: 'chapter' })],
            new Set(['a', 'b', 'c']),
        )
        expect(picked.map((m) => m.videoId)).toEqual(['b', 'c', 'a'])
    })
})

describe('excerpts', () => {
    const cues = [
        { from: 0, to: 80, text: 'вступление' },
        { from: 88, to: 95, text: 'теперь маунт.' },
        { from: 95, to: 120, text: 'Если держат голову,   упираемся в бицепс' },
        { from: 140, to: 160, text: 'и делаем мост' },
        { from: 170, to: 180, text: 'дальше другое' },
    ]

    it('reads the Russian translation when there is one', () => {
        expect(excerptCues({ segments: [{ from: 0, to: 1, text: 'en' }], translations: { ru: [{ from: 0, to: 1, text: 'ru' }] } })[0].text).toBe('ru')
        expect(excerptCues({ segments: [{ from: 0, to: 1, text: 'en' }], translations: null })[0].text).toBe('en')
        expect(excerptCues(undefined)).toEqual([])
    })

    it('takes the cues around the moment, from the first start to the last end', () => {
        const e = buildExcerpt(1, hit({ at: 100 }), cues)
        expect(e.text).toBe('теперь маунт. Если держат голову, упираемся в бицепс и делаем мост')
        expect(e.startAt).toBe(88)
        expect(e.endAt).toBe(160)
        expect(e.chapter).toBeNull()
        expect(e.snippet).toBe('выход из маунта')
    })

    it('a chapter without a transcript is its own text', () => {
        const e = buildExcerpt(2, hit({ kind: 'chapter', at: 61.4, text: 'Выход из маунта' }), [])
        expect(e).toMatchObject({ n: 2, text: 'Выход из маунта', chapter: 'Выход из маунта', startAt: 61, endAt: null })
    })

    it('numbers the excerpts for the model with the video, chapter and time', () => {
        const messages = buildAnswerMessages('как выйти?', [buildExcerpt(1, hit({ kind: 'chapter', at: 90, text: 'Маунт' }), cues)])
        expect(messages[0].content).toContain('NO_ANSWER')
        expect(messages[1].content).toContain('[1] Видео «Выходы», глава «Маунт», 1:28–2:00')
    })
})

describe('parseAnswer', () => {
    it('keeps only citations of real excerpts and renumbers them in order of appearance', () => {
        expect(parseAnswer('Упритесь в бицепс [3] и сделайте мост [7][1, 3].', [1, 2, 3])).toEqual({
            answer: 'Упритесь в бицепс [1] и сделайте мост [2][1].',
            cited: [3, 1],
        })
    })

    it('no answer: NO_ANSWER, empty, or nothing cited', () => {
        expect(parseAnswer('NO_ANSWER', [1])).toBeNull()
        expect(parseAnswer('   ', [1])).toBeNull()
        expect(parseAnswer('Делайте мост.', [1])).toBeNull()
        expect(parseAnswer('Делайте мост [4].', [1, 2])).toBeNull()
    })
})
