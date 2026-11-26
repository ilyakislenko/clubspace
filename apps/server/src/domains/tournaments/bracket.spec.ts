import {
    bracketSize,
    firstRoundMatches,
    nextSlot,
    type PlacingMatch,
    placingsFor,
    roundCount,
    seedBracket,
} from './bracket'

// Deterministic PRNG (mulberry32) for the sweeps.
const prng = (seed: number) => () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const athletes = (clubs: number[]) =>
    clubs.flatMap((size, c) =>
        Array.from({ length: size }, (_, i) => ({ id: `e${c}-${i}`, clubId: `club${c}` })),
    )

// For every node of the slot tree: [left, right] slot ranges.
const nodes = (size: number): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = []
    for (let span = size; span >= 2; span /= 2) {
        for (let start = 0; start < size; start += span) out.push([start, start + span / 2, span])
    }
    return out
}

const clubOf = (list: Array<{ id: string; clubId: string }>) =>
    new Map(list.map((a) => [a.id, a.clubId]))

// The round in which two slots can first meet.
const meetRound = (a: number, b: number): number => {
    let r = 1
    while (a >> r !== b >> r) r += 1
    return r
}

// Teammate pairs per meeting round, earliest first (smaller is better,
// compared lexicographically).
const clashProfile = (slots: Array<string | null>, clubs: Map<string, string>): number[] => {
    const rounds = roundCount(slots.length)
    const profile = Array.from({ length: rounds }, () => 0)
    for (let i = 0; i < slots.length; i += 1) {
        for (let j = i + 1; j < slots.length; j += 1) {
            const a = slots[i]
            const b = slots[j]
            if (a && b && clubs.get(a) === clubs.get(b)) profile[meetRound(i, j) - 1] += 1
        }
    }
    return profile
}

const lexLess = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] < b[i]
    return false
}

describe('bracketSize', () => {
    it('is the smallest power of two ≥ n', () => {
        expect([1, 2, 3, 4, 5, 8, 9, 16, 17, 64].map(bracketSize)).toEqual([
            1, 2, 4, 4, 8, 8, 16, 16, 32, 64,
        ])
    })
})

describe('seedBracket', () => {
    it('places every athlete once, byes only in round 1 and never two in a pair, for n = 1…64', () => {
        for (let n = 1; n <= 64; n += 1) {
            const list = athletes([Math.ceil(n / 3), Math.floor(n / 3), n - Math.ceil(n / 3) - Math.floor(n / 3)])
            const slots = seedBracket(list, `div:${n}`)
            const size = bracketSize(n)
            expect(slots).toHaveLength(size)
            expect(slots.filter(Boolean).sort()).toEqual(list.map((a) => a.id).sort())
            const matches = firstRoundMatches(slots)
            expect(matches.filter((m) => m.isBye)).toHaveLength(size - n)
            expect(matches.some((m) => m.entryAId === null && m.entryBId === null)).toBe(false)
            // A bye always sits on side B.
            expect(matches.filter((m) => m.isBye).every((m) => m.entryBId === null)).toBe(true)
        }
    })

    it('keeps every club balanced at every node unless a side is full (PRNG sweep)', () => {
        const rand = prng(42)
        for (let run = 0; run < 400; run += 1) {
            const n = 2 + Math.floor(rand() * 31)
            const clubCount = 1 + Math.floor(rand() * 6)
            const list = Array.from({ length: n }, (_, i) => ({
                id: `a${run}-${i}`,
                clubId: `c${Math.floor(rand() * clubCount)}`,
            }))
            const slots = seedBracket(list, `sweep:${run}`)
            const clubs = clubOf(list)
            for (const [start, mid, span] of nodes(slots.length)) {
                const left = slots.slice(start, mid).filter(Boolean) as string[]
                const right = slots.slice(mid, start + span).filter(Boolean) as string[]
                const k = left.length + right.length
                const capLeft = Math.ceil(k / 2)
                const capRight = Math.floor(k / 2)
                for (const club of new Set([...left, ...right].map((id) => clubs.get(id)))) {
                    const l = left.filter((id) => clubs.get(id) === club).length
                    const r = right.filter((id) => clubs.get(id) === club).length
                    const full =
                        (l > r && right.length === capRight) || (r > l && left.length === capLeft)
                    if (!full) expect(Math.abs(l - r)).toBeLessThanOrEqual(1)
                }
            }
        }
    })

    it('matches the brute-force optimum for n ≤ 8', () => {
        const rand = prng(7)
        const permutations = <T>(xs: T[]): T[][] =>
            xs.length <= 1
                ? [xs]
                : xs.flatMap((x, i) =>
                      permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
                  )
        for (let run = 0; run < 25; run += 1) {
            const n = 3 + Math.floor(rand() * 6)
            const list = Array.from({ length: n }, (_, i) => ({
                id: `b${i}`,
                clubId: `c${Math.floor(rand() * 3)}`,
            }))
            const clubs = clubOf(list)
            const size = bracketSize(n)
            const seeded = clashProfile(seedBracket(list, `bf:${run}`), clubs)
            // Every arrangement of athletes and byes without a pair of two byes.
            const items: Array<string | null> = [
                ...list.map((a) => a.id),
                ...Array.from({ length: size - n }, () => null),
            ]
            let best: number[] | null = null
            for (const slots of permutations(items)) {
                let doubleBye = false
                for (let i = 0; i < size; i += 2) {
                    if (slots[i] === null && slots[i + 1] === null) doubleBye = true
                }
                if (doubleBye) continue
                const profile = clashProfile(slots, clubs)
                if (!best || lexLess(profile, best)) best = profile
            }
            expect(seeded).toEqual(best)
        }
    })

    it('two teammates in an 8-bracket meet only in the final; four go one per quarter', () => {
        const two = athletes([2, 1, 1, 1, 1, 1, 1])
        const slots2 = seedBracket(two, 'two')
        const [a, b] = ['e0-0', 'e0-1'].map((id) => slots2.indexOf(id))
        expect(meetRound(a, b)).toBe(3)
        const four = athletes([4, 2, 2])
        const slots4 = seedBracket(four, 'four')
        const quarters = ['e0-0', 'e0-1', 'e0-2', 'e0-3'].map((id) =>
            Math.floor(slots4.indexOf(id) / 2),
        )
        expect(new Set(quarters).size).toBe(4)
    })

    it('ignores input order, repeats for the same salt and changes for another draw', () => {
        const list = athletes([3, 2, 2, 1])
        const reversed = [...list].reverse()
        expect(seedBracket(reversed, 'd:1')).toEqual(seedBracket(list, 'd:1'))
        expect(seedBracket(list, 'd:1')).toEqual(seedBracket(list, 'd:1'))
        const differs = [2, 3, 4, 5, 6].some(
            (drawNo) =>
                JSON.stringify(seedBracket(list, `d:${drawNo}`)) !==
                JSON.stringify(seedBracket(list, 'd:1')),
        )
        expect(differs).toBe(true)
    })

    it('a lone athlete is one slot without matches', () => {
        const slots = seedBracket([{ id: 'x', clubId: 'c' }], 's')
        expect(slots).toEqual(['x'])
        expect(firstRoundMatches(slots)).toEqual([])
    })
})

describe('nextSlot', () => {
    it('sends odd positions to side A and even to side B of the next round', () => {
        expect(nextSlot(1, 1)).toEqual({ round: 2, position: 1, side: 'A' })
        expect(nextSlot(1, 2)).toEqual({ round: 2, position: 1, side: 'B' })
        expect(nextSlot(2, 3)).toEqual({ round: 3, position: 2, side: 'A' })
        expect(nextSlot(3, 4)).toEqual({ round: 4, position: 2, side: 'B' })
    })
})

describe('placingsFor', () => {
    const m = (
        round: number,
        position: number,
        a: string | null,
        b: string | null,
        winner: string | null,
        method: PlacingMatch['method'] = 'POINTS',
    ): PlacingMatch => ({
        round,
        position,
        entryAId: a,
        entryBId: b,
        isBye: (a === null) !== (b === null),
        winnerEntryId: winner,
        method: winner ? method : null,
    })

    it('n = 1: the lone athlete is first', () => {
        expect([...placingsFor([], ['x'])]).toEqual([['x', 1]])
    })

    it('n = 2: the final only, 1 and 2', () => {
        expect(placingsFor([m(1, 1, 'a', 'b', 'b')], ['a', 'b'])).toEqual(
            new Map([
                ['b', 1],
                ['a', 2],
            ]),
        )
    })

    it('n = 3: one bronze (the other semifinal is a bye)', () => {
        const matches = [m(1, 1, 'a', 'b', 'a'), m(1, 2, 'c', null, 'c'), m(2, 1, 'a', 'c', 'c')]
        expect(placingsFor(matches, ['a', 'b', 'c'])).toEqual(
            new Map([
                ['c', 1],
                ['a', 2],
                ['b', 3],
            ]),
        )
    })

    it('n = 4: 1, 2, 3, 3', () => {
        const matches = [m(1, 1, 'a', 'b', 'a'), m(1, 2, 'c', 'd', 'd'), m(2, 1, 'a', 'd', 'a')]
        expect(placingsFor(matches, ['a', 'b', 'c', 'd'])).toEqual(
            new Map([
                ['a', 1],
                ['d', 2],
                ['b', 3],
                ['c', 3],
            ]),
        )
    })

    it('n = 5: the round-1 loser gets nothing, semifinal losers are third', () => {
        const matches = [
            m(1, 1, 'a', 'b', 'a'),
            m(1, 2, 'c', null, 'c'),
            m(1, 3, 'd', null, 'd'),
            m(1, 4, 'e', null, 'e'),
            m(2, 1, 'a', 'c', 'c'),
            m(2, 2, 'd', 'e', 'e'),
            m(3, 1, 'c', 'e', 'e'),
        ]
        const places = placingsFor(matches, ['a', 'b', 'c', 'd', 'e'])
        expect(places).toEqual(
            new Map([
                ['e', 1],
                ['c', 2],
                ['a', 3],
                ['d', 3],
            ]),
        )
    })

    it('n = 8: nothing until the final is decided, then 1/2/3/3', () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
        const r1 = [0, 1, 2, 3].map((i) => m(1, i + 1, ids[2 * i], ids[2 * i + 1], ids[2 * i]))
        const r2 = [m(2, 1, 'a', 'c', 'a'), m(2, 2, 'e', 'g', 'g')]
        expect(placingsFor([...r1, ...r2, m(3, 1, 'a', 'g', null)], ids).size).toBe(0)
        const places = placingsFor([...r1, ...r2, m(3, 1, 'a', 'g', 'g')], ids)
        expect([...places.entries()].sort()).toEqual([
            ['a', 2],
            ['c', 3],
            ['e', 3],
            ['g', 1],
        ])
    })

    it('a loser by walkover or disqualification gets no place', () => {
        const matches = [
            m(1, 1, 'a', 'b', 'a', 'WALKOVER'),
            m(1, 2, 'c', 'd', 'd', 'POINTS'),
            m(2, 1, 'a', 'd', 'a', 'DISQUALIFICATION'),
        ]
        expect(placingsFor(matches, ['a', 'b', 'c', 'd'])).toEqual(
            new Map([
                ['a', 1],
                ['c', 3],
            ]),
        )
    })
})
