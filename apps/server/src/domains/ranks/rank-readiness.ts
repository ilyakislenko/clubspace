// Pure maths for «допуск к аттестации»: when did the member reach their current
// level, what is the next level, and how far are they from its rule. No I/O —
// the handlers feed it rows.
import { pluralRu } from '../../shared/utils/plural-ru'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type PromotionRun = { levelId: string; stripes: number; awardedAt: Date }

export type CurrentLevelRun = {
    levelId: string
    stripes: number
    reachedAt: Date
}

// Newest first. The current level is the newest row; it was *reached* when the
// oldest row of the unbroken run on that level was awarded, so stripe
// promotions don't reset the counter and a level change does.
export const currentLevelRun = (
    promotionsNewestFirst: PromotionRun[],
): CurrentLevelRun | null => {
    const current = promotionsNewestFirst[0]
    if (!current) return null
    let reachedAt = current.awardedAt
    for (const p of promotionsNewestFirst) {
        if (p.levelId !== current.levelId) break
        reachedAt = p.awardedAt
    }
    return {
        levelId: current.levelId,
        stripes: current.stripes,
        reachedAt,
    }
}

export type LadderLevelRule = {
    id: string
    order: number
    isActive: boolean
    minVisits?: number | null
    minWeeks?: number | null
}

// First active level above the current one; null when the current level is
// unknown or the top.
export const nextLevelAfter = <T extends LadderLevelRule>(
    levelsAll: T[],
    currentLevelId: string,
): T | null => {
    const current = levelsAll.find((l) => l.id === currentLevelId)
    if (!current) return null
    return (
        [...levelsAll]
            .filter((l) => l.isActive && l.order > current.order)
            .sort((a, b) => a.order - b.order)[0] ?? null
    )
}

export const describeRemaining = (
    remainingVisits: number,
    remainingWeeks: number,
): string | null => {
    const visits =
        remainingVisits > 0
            ? `${remainingVisits} ${pluralRu(remainingVisits, 'тренировка', 'тренировки', 'тренировок')}`
            : null
    const weeks =
        remainingWeeks > 0
            ? `${remainingWeeks} ${pluralRu(remainingWeeks, 'неделя', 'недели', 'недель')}`
            : null
    if (visits && weeks) return `ещё ${visits} и ${weeks}`
    if (visits || weeks) return `ещё ${visits ?? weeks}`
    return null
}

export type Readiness = {
    rule: { minVisits: number | null; minWeeks: number | null } | null
    visitsSince: number
    weeksSince: number
    remainingVisits: number
    remainingWeeks: number
    ready: boolean
    remainingText: string | null
}

export const evaluateReadiness = (p: {
    nextLevel: Pick<LadderLevelRule, 'minVisits' | 'minWeeks'>
    reachedAt: Date
    visitsSince: number
    now: Date
}): Readiness => {
    const minVisits = p.nextLevel.minVisits ?? null
    const minWeeks = p.nextLevel.minWeeks ?? null
    const weeksSince = Math.max(
        0,
        Math.floor((p.now.getTime() - p.reachedAt.getTime()) / WEEK_MS),
    )
    const rule =
        minVisits === null && minWeeks === null ? null : { minVisits, minWeeks }
    const remainingVisits = Math.max(0, (minVisits ?? 0) - p.visitsSince)
    const remainingWeeks = Math.max(0, (minWeeks ?? 0) - weeksSince)
    const ready = rule !== null && remainingVisits === 0 && remainingWeeks === 0
    return {
        rule,
        visitsSince: p.visitsSince,
        weeksSince,
        remainingVisits,
        remainingWeeks,
        ready,
        remainingText:
            rule === null || ready
                ? null
                : describeRemaining(remainingVisits, remainingWeeks),
    }
}
