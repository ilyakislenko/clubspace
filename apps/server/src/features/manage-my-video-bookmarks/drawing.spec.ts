import {
    BookmarkDrawingSchema,
    DRAWING_MAX_POINTS,
    DRAWING_MAX_STROKES,
    parseStoredDrawing,
} from './drawing'

const arrow = { tool: 'arrow', color: 'red', points: [0.1, 0.2, 0.8, 0.9] }
const pen = (points: number) => ({
    tool: 'pen',
    color: 'yellow',
    points: Array.from({ length: points * 2 }, (_, i) => (i % 10) / 10),
})

const valid = (drawing: unknown) => BookmarkDrawingSchema.safeParse(drawing).success

describe('BookmarkDrawingSchema', () => {
    it('accepts pen, arrow and ellipse strokes in palette colors', () => {
        expect(
            valid({
                strokes: [
                    arrow,
                    pen(3),
                    { tool: 'ellipse', color: 'green', points: [0, 0, 1, 1] },
                    { ...arrow, color: 'white' },
                ],
            }),
        ).toBe(true)
    })

    it('rejects an empty drawing', () => {
        expect(valid({ strokes: [] })).toBe(false)
    })

    it(`rejects more than ${DRAWING_MAX_STROKES} strokes`, () => {
        expect(valid({ strokes: Array(DRAWING_MAX_STROKES).fill(arrow) })).toBe(true)
        expect(valid({ strokes: Array(DRAWING_MAX_STROKES + 1).fill(arrow) })).toBe(
            false,
        )
    })

    it(`rejects more than ${DRAWING_MAX_POINTS} points in total`, () => {
        const half = DRAWING_MAX_POINTS / 2
        expect(valid({ strokes: [pen(half), pen(half)] })).toBe(true)
        expect(valid({ strokes: [pen(half), pen(half + 1)] })).toBe(false)
    })

    it.each([
        ['a coordinate below 0', { ...arrow, points: [-0.01, 0, 1, 1] }],
        ['a coordinate above 1', { ...arrow, points: [0, 0, 1.01, 1] }],
        ['a color outside the palette', { ...arrow, color: '#ff0000' }],
        ['an unknown tool', { ...arrow, tool: 'text' }],
        ['an odd number of coordinates', { ...pen(2), points: [0, 0, 1, 1, 0.5] }],
        ['a single point', { ...pen(1) }],
        ['an arrow with three points', { ...arrow, points: [0, 0, 0.5, 0.5, 1, 1] }],
    ])('rejects %s', (_, stroke) => {
        expect(valid({ strokes: [stroke] })).toBe(false)
    })
})

describe('parseStoredDrawing', () => {
    it('returns a valid stored drawing', () => {
        expect(parseStoredDrawing({ strokes: [arrow] })).toEqual({ strokes: [arrow] })
    })

    it.each([null, undefined, 'x', { strokes: [{ tool: 'pen' }] }])(
        'treats %p as no drawing',
        (value) => {
            expect(parseStoredDrawing(value)).toBeNull()
        },
    )
})
