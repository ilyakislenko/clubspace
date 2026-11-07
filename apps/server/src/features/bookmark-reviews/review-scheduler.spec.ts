import {
    applyGrade,
    dueAfter,
    MAX_EASE,
    MAX_INTERVAL_DAYS,
    MIN_EASE,
    NEW_CARD,
    newCardDueAt,
    previewIntervals,
    REVIEW_GRADES,
    type ReviewState,
} from './review-scheduler'

const learned = (over: Partial<ReviewState> = {}): ReviewState => ({
    intervalDays: 10,
    ease: 2.5,
    reps: 3,
    lapses: 0,
    ...over,
})

describe('review scheduler', () => {
    describe('new card', () => {
        it.each([
            ['again', 0],
            ['hard', 1],
            ['good', 2],
            ['easy', 4],
        ] as const)('%s → %i days', (grade, days) => {
            expect(applyGrade(NEW_CARD, grade).intervalDays).toBe(days)
        })

        it('is due one day after it was saved', () => {
            expect(newCardDueAt(new Date('2026-01-01T10:00:00Z'))).toEqual(
                new Date('2026-01-02T10:00:00Z'),
            )
        })

        it("doesn't count forgetting a card never learned as a lapse", () => {
            expect(applyGrade(NEW_CARD, 'again')).toEqual({
                intervalDays: 0,
                ease: 2.3,
                reps: 0,
                lapses: 0,
            })
        })
    })

    describe('learned card (interval 10, ease 2.5)', () => {
        it.each([
            ['hard', 12, 2.35],
            ['good', 25, 2.5],
            ['easy', 33, 2.65],
        ] as const)('%s → %i days, ease %d, one more rep', (grade, days, ease) => {
            expect(applyGrade(learned(), grade)).toEqual({
                intervalDays: days,
                ease,
                reps: 4,
                lapses: 0,
            })
        })

        it('again is a lapse: back to minutes, reps reset, ease down', () => {
            expect(applyGrade(learned({ lapses: 1 }), 'again')).toEqual({
                intervalDays: 0,
                ease: 2.3,
                reps: 0,
                lapses: 2,
            })
        })

        it('relearns from the new-card steps after a lapse', () => {
            const lapsed = applyGrade(learned(), 'again')
            expect(applyGrade(lapsed, 'good')).toMatchObject({
                intervalDays: 2,
                reps: 1,
                lapses: 1,
            })
        })
    })

    it('always orders again < hard < good < easy and never shrinks a passed gap', () => {
        for (const state of [
            learned({ intervalDays: 1, ease: MIN_EASE, reps: 1 }),
            learned({ intervalDays: 2, ease: MIN_EASE }),
            learned({ intervalDays: 4, ease: MAX_EASE }),
        ]) {
            const p = previewIntervals(state)
            expect(p.again).toBeLessThan(p.hard)
            expect(p.hard).toBeGreaterThan(state.intervalDays)
            expect(p.hard).toBeLessThan(p.good)
            expect(p.good).toBeLessThan(p.easy)
        }
    })

    it('previews exactly what grading schedules', () => {
        const state = learned({ intervalDays: 7, ease: 2.1 })
        const p = previewIntervals(state)
        for (const grade of REVIEW_GRADES) {
            expect(applyGrade(state, grade).intervalDays).toBe(p[grade])
        }
    })

    describe('ease bounds', () => {
        it(`never drops below ${MIN_EASE}`, () => {
            let state = learned({ ease: 1.4 })
            for (let i = 0; i < 5; i++) state = applyGrade(state, 'again')
            expect(state.ease).toBe(MIN_EASE)
            expect(applyGrade(learned({ ease: MIN_EASE }), 'hard').ease).toBe(MIN_EASE)
        })

        it(`never rises above ${MAX_EASE}`, () => {
            expect(applyGrade(learned({ ease: 2.95 }), 'easy').ease).toBe(MAX_EASE)
        })

        it('rounds away float drift', () => {
            let state = NEW_CARD
            for (let i = 0; i < 3; i++) state = applyGrade(state, 'hard')
            expect(state.ease).toBe(2.05)
        })
    })

    it(`caps intervals at ${MAX_INTERVAL_DAYS} days`, () => {
        const state = learned({ intervalDays: 300, ease: MAX_EASE })
        expect(previewIntervals(state)).toEqual({
            again: 0,
            hard: 360,
            good: MAX_INTERVAL_DAYS,
            easy: MAX_INTERVAL_DAYS,
        })
    })

    it('counts the due date from the review time', () => {
        const at = new Date('2026-03-01T08:00:00Z')
        expect(dueAfter(at, 0)).toEqual(new Date('2026-03-01T08:10:00Z'))
        expect(dueAfter(at, 3)).toEqual(new Date('2026-03-04T08:00:00Z'))
    })
})
