// Single-elimination brackets (design docs/design/2026-11-27-tournaments.md
// §4.2): seeding with same-club athletes apart, byes, advancement, placings
// 1/2/3/3. Pure and deterministic — the demo seed calls the same functions,
// so demo brackets are real brackets.
import { createHash } from 'crypto'

export type MatchSide = 'A' | 'B'

export type MethodName = 'FINISH' | 'POINTS' | 'DECISION' | 'DISQUALIFICATION' | 'WALKOVER'

// Smallest power of two ≥ n; 1 athlete → 1 slot, no matches.
export const bracketSize = (n: number): number => {
    let size = 1
    while (size < n) size *= 2
    return size
}

export const roundCount = (size: number): number => Math.round(Math.log2(Math.max(1, size)))

const hashOf = (salt: string, x: string): string =>
    createHash('sha256').update(salt + x).digest('hex')

type Seedable = { id: string; clubId: string }

// Splits `list` (already ordered) into a node of `size` slots. A node with k
// athletes gives the left half ceil(k/2) and the right half floor(k/2);
// since every subtree keeps k ≥ size/2, byes land only in round 1 and never
// two in one pair. Each athlete goes to the half with fewer of their own
// club; on a tie the half with more room left, then the side picked by a bit
// of h(clubId). A full half is skipped.
const place = (
    list: Seedable[],
    size: number,
    side: (clubId: string) => 0 | 1,
): Array<string | null> => {
    if (size === 1) return [list[0]?.id ?? null]
    const target = [Math.ceil(list.length / 2), Math.floor(list.length / 2)]
    const halves: Seedable[][] = [[], []]
    const clubCount = [new Map<string, number>(), new Map<string, number>()]
    for (const athlete of list) {
        const room = [target[0] - halves[0].length, target[1] - halves[1].length]
        let pick: 0 | 1
        if (room[0] <= 0) pick = 1
        else if (room[1] <= 0) pick = 0
        else {
            const own = [
                clubCount[0].get(athlete.clubId) ?? 0,
                clubCount[1].get(athlete.clubId) ?? 0,
            ]
            if (own[0] !== own[1]) pick = own[0] < own[1] ? 0 : 1
            else if (room[0] !== room[1]) pick = room[0] > room[1] ? 0 : 1
            else pick = side(athlete.clubId)
        }
        halves[pick].push(athlete)
        clubCount[pick].set(athlete.clubId, (clubCount[pick].get(athlete.clubId) ?? 0) + 1)
    }
    return [...place(halves[0], size / 2, side), ...place(halves[1], size / 2, side)]
}

// The first-round slots (entry id or null = bye) of length bracketSize(n).
// Salt = `${divisionId}:${drawNo}`, so «Пережеребить» (drawNo + 1) gives a
// new bracket and the same draw is reproducible. Input order doesn't matter:
// clubs by size desc then h(clubId), athletes of a club by h(entryId).
export const seedBracket = (entries: Seedable[], salt: string): Array<string | null> => {
    const size = bracketSize(entries.length)
    if (entries.length === 0) return []
    const h = new Map<string, string>()
    const hash = (x: string) => {
        let v = h.get(x)
        if (v === undefined) {
            v = hashOf(salt, x)
            h.set(x, v)
        }
        return v
    }
    const clubs = new Map<string, Seedable[]>()
    for (const e of entries) {
        const list = clubs.get(e.clubId) ?? []
        list.push(e)
        clubs.set(e.clubId, list)
    }
    const ordered = [...clubs.entries()]
        .sort(([a, x], [b, y]) => y.length - x.length || (hash(a) < hash(b) ? -1 : 1))
        .flatMap(([, list]) =>
            [...list].sort((x, y) => (hash(x.id) < hash(y.id) ? -1 : hash(x.id) > hash(y.id) ? 1 : 0)),
        )
    const side = (clubId: string): 0 | 1 => (parseInt(hash(clubId)[0], 16) & 1 ? 1 : 0)
    return place(ordered, size, side)
}

export type FirstRoundMatch = {
    position: number
    entryAId: string | null
    entryBId: string | null
    isBye: boolean
}

// Round-1 pairs of the slots; a pair with one athlete is a bye (decided at
// the draw). One slot (a lone athlete) has no matches.
export const firstRoundMatches = (slots: Array<string | null>): FirstRoundMatch[] => {
    const out: FirstRoundMatch[] = []
    for (let i = 0; i + 1 < slots.length; i += 2) {
        const a = slots[i]
        const b = slots[i + 1]
        out.push({
            position: i / 2 + 1,
            entryAId: a,
            entryBId: b,
            isBye: (a === null) !== (b === null),
        })
    }
    return out
}

// Where the winner of (round, position) goes.
export const nextSlot = (
    round: number,
    position: number,
): { round: number; position: number; side: MatchSide } => ({
    round: round + 1,
    position: Math.ceil(position / 2),
    side: position % 2 === 1 ? 'A' : 'B',
})

export type PlacingMatch = {
    round: number
    position: number
    entryAId: string | null
    entryBId: string | null
    isBye: boolean
    winnerEntryId: string | null
    method: MethodName | null
}

// A loser by walkover or disqualification gets no place.
const loserPlaced = (m: PlacingMatch): string | null => {
    if (m.isBye || !m.winnerEntryId) return null
    if (m.method === 'WALKOVER' || m.method === 'DISQUALIFICATION') return null
    return m.winnerEntryId === m.entryAId ? m.entryBId : m.entryAId
}

// Places once the final is decided (empty until then): 1 = final winner,
// 2 = final loser, 3 = each loser of the semifinal round (one in a division
// of three, none in a division of two). A lone athlete is 1st.
export const placingsFor = (
    matches: PlacingMatch[],
    entryIds: string[],
): Map<string, number> => {
    const places = new Map<string, number>()
    if (entryIds.length === 1) {
        places.set(entryIds[0], 1)
        return places
    }
    const rounds = roundCount(bracketSize(entryIds.length))
    if (rounds === 0) return places
    const final = matches.find((m) => m.round === rounds && m.position === 1)
    if (!final?.winnerEntryId) return places
    places.set(final.winnerEntryId, 1)
    const second = loserPlaced(final)
    if (second) places.set(second, 2)
    for (const m of matches.filter((x) => x.round === rounds - 1)) {
        const third = loserPlaced(m)
        if (third) places.set(third, 3)
    }
    return places
}
