/**
 * «Повторение» — an SM-2-lite spaced-repetition schedule for the member's
 * bookmarks and A–B segments. Pure; the handlers persist its output.
 *
 * A card's state: `intervalDays` (the gap just scheduled), `ease` (growth
 * factor), `reps` (successful reviews in a row) and `lapses` (times a learned
 * card was forgotten). A bookmark without a schedule row is a «new» card
 * (reps 0, ease 2.5) and is due NEW_CARD_DELAY_DAYS after it was saved.
 *
 * Grading (prev = the current intervalDays, at least 1; ease = the current
 * ease — the grade's ease change only affects later reviews):
 * - again: intervalDays 0 = due again in AGAIN_DELAY_MINUTES; reps → 0;
 *   ease − 0.2; a learned card (reps > 0) counts a lapse.
 * - hard:  new → 1 day, else max(prev + 1, round(prev × 1.2)); ease − 0.15.
 * - good:  new → 2 days, else max(hard + 1, round(prev × ease)); ease kept.
 * - easy:  new → 4 days, else max(good + 1, round(prev × ease × 1.3));
 *   ease + 0.15.
 * hard/good/easy add one rep. So a later grade always waits longer than an
 * earlier one (again < hard ≤ good < easy) and a passed review never shrinks
 * the gap. Ease stays within [MIN_EASE, MAX_EASE], intervals within
 * MAX_INTERVAL_DAYS. The due date counts from the grade's own time.
 */

export const REVIEW_GRADES = ['again', 'hard', 'good', 'easy'] as const
export type ReviewGrade = (typeof REVIEW_GRADES)[number]

export type ReviewState = {
    intervalDays: number
    ease: number
    reps: number
    lapses: number
}

export const NEW_CARD: ReviewState = {
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
}

export const NEW_CARD_DELAY_DAYS = 1
export const AGAIN_DELAY_MINUTES = 10
export const MIN_EASE = 1.3
export const MAX_EASE = 3
export const MAX_INTERVAL_DAYS = 365

const DAY_MS = 24 * 60 * 60 * 1000
const EASE_DELTA: Record<ReviewGrade, number> = {
    again: -0.2,
    hard: -0.15,
    good: 0,
    easy: 0.15,
}

const clampEase = (ease: number) =>
    Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, ease)) * 100) / 100

const capInterval = (days: number) => Math.min(MAX_INTERVAL_DAYS, days)

/** Days until the next review for each grade (0 = again, minutes away). */
export const previewIntervals = (
    state: ReviewState,
): Record<ReviewGrade, number> => {
    if (state.reps === 0) {
        return { again: 0, hard: 1, good: 2, easy: 4 }
    }
    const prev = Math.max(1, state.intervalDays)
    const hard = Math.max(prev + 1, Math.round(prev * 1.2))
    const good = Math.max(hard + 1, Math.round(prev * state.ease))
    const easy = Math.max(good + 1, Math.round(prev * state.ease * 1.3))
    return {
        again: 0,
        hard: capInterval(hard),
        good: capInterval(good),
        easy: capInterval(easy),
    }
}

export const applyGrade = (
    state: ReviewState,
    grade: ReviewGrade,
): ReviewState => {
    const ease = clampEase(state.ease + EASE_DELTA[grade])
    if (grade === 'again') {
        return {
            intervalDays: 0,
            ease,
            reps: 0,
            lapses: state.lapses + (state.reps > 0 ? 1 : 0),
        }
    }
    return {
        intervalDays: previewIntervals(state)[grade],
        ease,
        reps: state.reps + 1,
        lapses: state.lapses,
    }
}

/** When a card graded at `reviewedAt` with this interval comes due. */
export const dueAfter = (reviewedAt: Date, intervalDays: number): Date =>
    new Date(
        reviewedAt.getTime() +
            (intervalDays === 0
                ? AGAIN_DELAY_MINUTES * 60 * 1000
                : intervalDays * DAY_MS),
    )

/** A never-reviewed bookmark's due date. */
export const newCardDueAt = (createdAt: Date): Date =>
    new Date(createdAt.getTime() + NEW_CARD_DELAY_DAYS * DAY_MS)
