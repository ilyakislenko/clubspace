// Mat queues and «your next match» (design
// docs/design/2026-11-27-tournaments.md §4.3). Pure. A mat runs one division
// to its end before the next (division `matOrder`, then round, then
// position); positions, not clock times.

export type ScheduleDivision = {
    id: string
    sortOrder: number
    mat: number | null
    matOrder: number | null
}

export type ScheduleMatch = {
    id: string
    divisionId: string
    round: number
    position: number
    entryAId: string | null
    entryBId: string | null
    isBye: boolean
    winnerEntryId: string | null
}

// Both athletes known, undecided, not a bye.
export const isReady = (m: ScheduleMatch): boolean =>
    !m.isBye && m.entryAId !== null && m.entryBId !== null && m.winnerEntryId === null

const divisionRank = (d: ScheduleDivision): [number, number] => [
    d.matOrder ?? Number.MAX_SAFE_INTEGER,
    d.sortOrder,
]

// The ready matches of one mat, in the order they will be fought. Divisions
// without a mat aren't queued anywhere.
export const matQueue = <M extends ScheduleMatch>(
    divisions: ScheduleDivision[],
    matches: M[],
    mat: number,
): M[] => {
    const onMat = new Map(
        divisions.filter((d) => d.mat === mat).map((d) => [d.id, divisionRank(d)]),
    )
    return matches
        .filter((m) => onMat.has(m.divisionId) && isReady(m))
        .sort((a, b) => {
            const [ao, as] = onMat.get(a.divisionId)!
            const [bo, bs] = onMat.get(b.divisionId)!
            return ao - bo || as - bs || a.round - b.round || a.position - b.position
        })
}

// Matches fought before `match` on its mat, ready or not: every undecided
// match of the divisions queued earlier there (a division runs to its end
// before the next) and of its own division's earlier rounds and positions.
// It only ever goes down as results come in. Null without a mat.
export const matchesAhead = (
    divisions: ScheduleDivision[],
    matches: ScheduleMatch[],
    match: Pick<ScheduleMatch, 'id' | 'divisionId' | 'round' | 'position'>,
): number | null => {
    const mat = divisions.find((d) => d.id === match.divisionId)?.mat ?? null
    if (mat === null) return null
    const rank = new Map(
        divisions.filter((d) => d.mat === mat).map((d) => [d.id, divisionRank(d)]),
    )
    const key = (m: Pick<ScheduleMatch, 'divisionId' | 'round' | 'position'>) => [
        ...rank.get(m.divisionId)!,
        m.round,
        m.position,
    ]
    const mine = key(match)
    const before = (k: number[]) => {
        for (let i = 0; i < k.length; i += 1) if (k[i] !== mine[i]) return k[i] < mine[i]
        return false
    }
    return matches.filter(
        (m) =>
            m.id !== match.id &&
            rank.has(m.divisionId) &&
            !m.isBye &&
            m.winnerEntryId === null &&
            before(key(m)),
    ).length
}

export type NextMatch = {
    matchId: string
    mat: number | null
    // Matches in front on that mat (matchesAhead); null while the opponent
    // is unknown or the division has no mat.
    ahead: number | null
    opponentEntryId: string | null
    // The match whose winner will be the opponent («ждёт победителя схватки
    // Петров — Сидоров»).
    waitingFor: { matchId: string; entryAId: string | null; entryBId: string | null } | null
}

// The undecided match the entry is in, or null when eliminated or done (the
// caller shows the place, when there is one).
export const nextMatchFor = (
    entryId: string,
    divisions: ScheduleDivision[],
    matches: ScheduleMatch[],
): NextMatch | null => {
    const current = matches
        .filter(
            (m) =>
                !m.isBye &&
                m.winnerEntryId === null &&
                (m.entryAId === entryId || m.entryBId === entryId),
        )
        .sort((a, b) => a.round - b.round)[0]
    if (!current) return null
    const division = divisions.find((d) => d.id === current.divisionId)
    const mat = division?.mat ?? null
    const opponentEntryId = current.entryAId === entryId ? current.entryBId : current.entryAId
    if (opponentEntryId !== null) {
        return {
            matchId: current.id,
            mat,
            ahead: matchesAhead(divisions, matches, current),
            opponentEntryId,
            waitingFor: null,
        }
    }
    // The empty side is fed by (round − 1, 2p − 1) for A and (round − 1, 2p) for B.
    const feederPosition =
        current.entryAId === null ? current.position * 2 - 1 : current.position * 2
    const feeder = matches.find(
        (m) =>
            m.divisionId === current.divisionId &&
            m.round === current.round - 1 &&
            m.position === feederPosition,
    )
    return {
        matchId: current.id,
        mat,
        ahead: null,
        opponentEntryId: null,
        waitingFor: feeder
            ? { matchId: feeder.id, entryAId: feeder.entryAId, entryBId: feeder.entryBId }
            : null,
    }
}

export type MatPlanDivision = ScheduleDivision & {
    entryCount: number
    // A division with results keeps its mat and place in the queue.
    hasResults: boolean
}

// «Распределить по коврам»: longest first (estimated matches = entries − 1)
// onto the least-loaded mat; on each mat the newly placed divisions queue by
// sortOrder after the ones that keep their place. Returns the new mat and
// matOrder of every division without results.
export const autoAssignMats = (
    divisions: MatPlanDivision[],
    matCount: number,
): Array<{ id: string; mat: number; matOrder: number }> => {
    const load = Array.from({ length: matCount }, () => 0)
    const keptMaxOrder = Array.from({ length: matCount }, () => 0)
    for (const d of divisions) {
        if (!d.hasResults || d.mat === null || d.mat < 1 || d.mat > matCount) continue
        load[d.mat - 1] += Math.max(0, d.entryCount - 1)
        keptMaxOrder[d.mat - 1] = Math.max(keptMaxOrder[d.mat - 1], d.matOrder ?? 0)
    }
    const free = divisions
        .filter((d) => !d.hasResults)
        .sort((a, b) => b.entryCount - a.entryCount || a.sortOrder - b.sortOrder)
    const assigned = new Map<number, MatPlanDivision[]>()
    for (const d of free) {
        let best = 0
        for (let i = 1; i < matCount; i += 1) if (load[i] < load[best]) best = i
        load[best] += Math.max(0, d.entryCount - 1)
        const list = assigned.get(best) ?? []
        list.push(d)
        assigned.set(best, list)
    }
    const out: Array<{ id: string; mat: number; matOrder: number }> = []
    for (const [index, list] of assigned) {
        list.sort((a, b) => a.sortOrder - b.sortOrder)
        list.forEach((d, i) =>
            out.push({ id: d.id, mat: index + 1, matOrder: keptMaxOrder[index] + i + 1 }),
        )
    }
    return out
}
