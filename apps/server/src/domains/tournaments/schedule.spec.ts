import { autoAssignMats, matchesAhead, matQueue, nextMatchFor, type ScheduleMatch } from './schedule'

const m = (
    id: string,
    divisionId: string,
    round: number,
    position: number,
    a: string | null,
    b: string | null,
    winner: string | null = null,
    isBye = false,
): ScheduleMatch => ({
    id,
    divisionId,
    round,
    position,
    entryAId: a,
    entryBId: b,
    isBye,
    winnerEntryId: winner,
})

const divisions = [
    { id: 'd1', sortOrder: 1, mat: 2, matOrder: 2 },
    { id: 'd2', sortOrder: 2, mat: 2, matOrder: 1 },
    { id: 'd3', sortOrder: 3, mat: null, matOrder: null },
    { id: 'd4', sortOrder: 4, mat: 1, matOrder: 1 },
]

// d2 (first on mat 2): a 4-bracket with one semifinal decided.
// d1 (second on mat 2): 5 athletes — one real round-1 match, three byes.
const matches = [
    m('d2-1-1', 'd2', 1, 1, 'p', 'q', 'p'),
    m('d2-1-2', 'd2', 1, 2, 'r', 's'),
    m('d2-2-1', 'd2', 2, 1, 'p', null),
    m('d1-1-1', 'd1', 1, 1, 'a', 'b'),
    m('d1-1-2', 'd1', 1, 2, 'c', null, 'c', true),
    m('d1-1-3', 'd1', 1, 3, 'd', null, 'd', true),
    m('d1-1-4', 'd1', 1, 4, 'e', null, 'e', true),
    m('d1-2-1', 'd1', 2, 1, null, 'c'),
    m('d1-2-2', 'd1', 2, 2, 'd', 'e'),
    m('d1-3-1', 'd1', 3, 1, null, null),
    m('d3-1-1', 'd3', 1, 1, 'x', 'y'),
]

describe('matQueue', () => {
    it('lists ready matches by division matOrder, then round and position; byes skipped', () => {
        expect(matQueue(divisions, matches, 2).map((x) => x.id)).toEqual([
            'd2-1-2',
            'd1-1-1',
            'd1-2-2',
        ])
    })

    it('a division without a mat is queued nowhere', () => {
        expect(matQueue(divisions, matches, 1)).toEqual([])
        for (const mat of [1, 2]) {
            expect(matQueue(divisions, matches, mat).some((x) => x.divisionId === 'd3')).toBe(false)
        }
    })
})

describe('nextMatchFor', () => {
    it('counts the matches ahead, ready or not, and names the opponent', () => {
        // d2 runs first on mat 2: its open semifinal and its final (not ready yet).
        expect(nextMatchFor('b', divisions, matches)).toEqual({
            matchId: 'd1-1-1',
            mat: 2,
            ahead: 2,
            opponentEntryId: 'a',
            waitingFor: null,
        })
        expect(nextMatchFor('r', divisions, matches)?.ahead).toBe(0)
    })

    it('«перед вами» never grows as results come in', () => {
        const afterSemi = matches.map((x) =>
            x.id === 'd2-1-2' ? { ...x, winnerEntryId: 'r' } : x.id === 'd2-2-1' ? { ...x, entryBId: 'r' } : x,
        )
        expect(nextMatchFor('b', divisions, afterSemi)?.ahead).toBe(1)
        const afterFinal = afterSemi.map((x) => (x.id === 'd2-2-1' ? { ...x, winnerEntryId: 'p' } : x))
        expect(nextMatchFor('b', divisions, afterFinal)?.ahead).toBe(0)
    })

    it('waits for the winner of the feeding match', () => {
        expect(nextMatchFor('c', divisions, matches)).toEqual({
            matchId: 'd1-2-1',
            mat: 2,
            ahead: null,
            opponentEntryId: null,
            waitingFor: { matchId: 'd1-1-1', entryAId: 'a', entryBId: 'b' },
        })
        expect(nextMatchFor('p', divisions, matches)?.waitingFor?.matchId).toBe('d2-1-2')
    })

    it('null for an eliminated athlete', () => {
        expect(nextMatchFor('q', divisions, matches)).toBeNull()
    })

    it('a ready match without a mat has no queue position', () => {
        expect(nextMatchFor('x', divisions, matches)).toMatchObject({ mat: null, ahead: null })
    })
})

describe('matchesAhead', () => {
    it('counts earlier divisions on the mat, then earlier rounds and positions of its own', () => {
        // d1-2-2: d2's semifinal + final, d1's round-1 match, d1-2-1 (round 2, position 1).
        expect(matchesAhead(divisions, matches, matches.find((x) => x.id === 'd1-2-2')!)).toBe(4)
        expect(matchesAhead(divisions, matches, matches.find((x) => x.id === 'd2-1-2')!)).toBe(0)
        expect(matchesAhead(divisions, matches, matches.find((x) => x.id === 'd3-1-1')!)).toBeNull()
    })
})

describe('autoAssignMats', () => {
    it('spreads the longest divisions first over the least-loaded mats', () => {
        const plan = autoAssignMats(
            [
                { id: 'a', sortOrder: 1, mat: null, matOrder: null, entryCount: 16, hasResults: false },
                { id: 'b', sortOrder: 2, mat: null, matOrder: null, entryCount: 8, hasResults: false },
                { id: 'c', sortOrder: 3, mat: null, matOrder: null, entryCount: 8, hasResults: false },
                { id: 'd', sortOrder: 4, mat: null, matOrder: null, entryCount: 2, hasResults: false },
            ],
            2,
        )
        const byId = new Map(plan.map((p) => [p.id, p]))
        // a (15 matches) alone on one mat; b + c (7 + 7 = 14) on the other,
        // which is still the lighter one for d (1).
        expect(byId.get('a')?.mat).toBe(1)
        expect(byId.get('b')?.mat).toBe(2)
        expect(byId.get('c')?.mat).toBe(2)
        expect(byId.get('d')?.mat).toBe(2)
        // Queue order on a mat follows sortOrder.
        expect(byId.get('a')?.matOrder).toBe(1)
        expect(['b', 'c', 'd'].map((id) => byId.get(id)?.matOrder)).toEqual([1, 2, 3])
    })

    it('leaves divisions with results where they are and queues the rest after them', () => {
        const plan = autoAssignMats(
            [
                { id: 'kept', sortOrder: 1, mat: 1, matOrder: 3, entryCount: 30, hasResults: true },
                { id: 'x', sortOrder: 2, mat: 1, matOrder: 1, entryCount: 4, hasResults: false },
                { id: 'y', sortOrder: 3, mat: null, matOrder: null, entryCount: 4, hasResults: false },
            ],
            2,
        )
        expect(plan.find((p) => p.id === 'kept')).toBeUndefined()
        expect(plan.find((p) => p.id === 'x')).toMatchObject({ mat: 2, matOrder: 1 })
        expect(plan.find((p) => p.id === 'y')).toMatchObject({ mat: 2, matOrder: 2 })
    })
})
