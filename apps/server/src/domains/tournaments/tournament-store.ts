// Bracket writes of federation tournaments (design
// docs/design/2026-11-27-tournaments.md §4.4, §2.1). Every write to a
// division's bracket (draw, result, undo, move, withdrawal) takes that
// division's row lock (SELECT … FOR UPDATE; a move locks both divisions in id
// order), so two tablets never interleave on one bracket. Phase changes take
// the tournament's row lock, which club-side entry writes take too.
import type {
    PrismaService,
    PrismaTransactionClientType,
} from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError, StaleUpdateError } from '../../shared/errors/shared.errors'
import { claimUnchanged } from '../../shared/utils/optimistic-concurrency'
import { pluralRu } from '../../shared/utils/plural-ru'
import {
    bracketSize,
    firstRoundMatches,
    type MethodName,
    nextSlot,
    placingsFor,
    roundCount,
    seedBracket,
} from './bracket'
import {
    DivisionHasResultsError,
    MatchUndoBlockedError,
    TournamentPublishedError,
    TournamentLockedError,
    TournamentUnassignedError,
} from './tournament-errors'

type Tx = PrismaTransactionClientType

export type TournamentStatusName = 'SETUP' | 'WEIGH_IN' | 'RUNNING' | 'FINISHED'

export const MAX_DRAW_ENTRIES = 64
export const NOT_WEIGHED_REASON = 'Не взвешен'
// STALE_UPDATE on a match decided with another result (a second tablet).
export const RESULT_ALREADY_RECORDED = 'Результат уже записан с другого планшета'

export const lockTournament = async (
    tx: Tx,
    tournamentId: string,
): Promise<{ status: TournamentStatusName }> => {
    const [row] = await tx.$queryRaw<Array<{ status: TournamentStatusName }>>`
        SELECT "status"::text AS "status" FROM "Tournament" WHERE "id" = ${tournamentId}::uuid FOR UPDATE`
    if (!row) throw new NotFoundError({ message: 'Турнир не найден' })
    return row
}

// Locks in id order (no deadlock between two moves in opposite directions).
const lockDivisions = async (tx: Tx, ids: string[]): Promise<void> => {
    for (const id of [...new Set(ids)].sort()) {
        const [row] = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "TournamentDivision" WHERE "id" = ${id}::uuid FOR UPDATE`
        if (!row) throw new NotFoundError({ message: 'Категория не найдена' })
    }
}

// A non-bye match decided: the division has results.
const hasResults = async (tx: Tx, divisionId: string): Promise<boolean> =>
    (await tx.tournamentMatch.count({
        where: { divisionId, isBye: false, decidedAt: { not: null } },
    })) > 0

// Drops a bracket without results: the division waits for a new draw.
const clearBracket = async (tx: Tx, divisionId: string): Promise<void> => {
    await tx.tournamentMatch.deleteMany({ where: { divisionId } })
    await tx.tournamentEntry.updateMany({ where: { divisionId }, data: { place: null } })
    await tx.tournamentDivision.update({
        where: { id: divisionId },
        data: { drawnAt: null, finishedAt: null },
        select: { id: true },
    })
}

// Who takes part in a draw: confirmed, weighed, in the division.
const eligibleEntries = (tx: Tx, divisionId: string) =>
    tx.tournamentEntry.findMany({
        where: { divisionId, status: 'CONFIRMED', weighedWeightG: { not: null } },
        select: { id: true, workspaceId: true },
    })

// The draw inside a transaction that holds the division lock. Writes every
// round (later rounds empty), resolves byes at once and stamps drawnAt; a
// lone athlete is 1st at once («без соперника»).
const drawLocked = async (
    tx: Tx,
    p: { tournamentId: string; divisionId: string; now: Date },
): Promise<{ drawNo: number; entries: number }> => {
    if (await hasResults(tx, p.divisionId)) {
        throw new DivisionHasResultsError(
            'В категории уже есть результаты — пережеребить нельзя',
        )
    }
    const entries = await eligibleEntries(tx, p.divisionId)
    if (entries.length === 0) {
        throw new BadRequestError({ message: 'В категории нет взвешенных участников' })
    }
    if (entries.length > MAX_DRAW_ENTRIES) {
        throw new BadRequestError({
            message: `В категории ${entries.length} участников — разделите категорию (не больше ${MAX_DRAW_ENTRIES})`,
        })
    }
    await tx.tournamentMatch.deleteMany({ where: { divisionId: p.divisionId } })
    await tx.tournamentEntry.updateMany({
        where: { divisionId: p.divisionId },
        data: { place: null },
    })
    const division = await tx.tournamentDivision.update({
        where: { id: p.divisionId },
        data: { drawNo: { increment: 1 }, drawnAt: p.now, finishedAt: null },
        select: { drawNo: true },
    })
    if (entries.length === 1) {
        await tx.tournamentEntry.update({
            where: { id: entries[0].id },
            data: { place: 1 },
            select: { id: true },
        })
        await tx.tournamentDivision.update({
            where: { id: p.divisionId },
            data: { finishedAt: p.now },
            select: { id: true },
        })
        return { drawNo: division.drawNo, entries: 1 }
    }
    const slots = seedBracket(
        entries.map((e) => ({ id: e.id, clubId: e.workspaceId })),
        `${p.divisionId}:${division.drawNo}`,
    )
    const size = bracketSize(entries.length)
    const rounds = roundCount(size)
    const later = new Map<string, { entryAId: string | null; entryBId: string | null }>()
    const rows: Array<{
        divisionId: string
        tournamentId: string
        round: number
        position: number
        entryAId: string | null
        entryBId: string | null
        isBye: boolean
        winnerEntryId: string | null
        decidedAt: Date | null
    }> = []
    for (const m of firstRoundMatches(slots)) {
        const winner = m.isBye ? (m.entryAId ?? m.entryBId) : null
        rows.push({
            divisionId: p.divisionId,
            tournamentId: p.tournamentId,
            round: 1,
            position: m.position,
            entryAId: m.entryAId,
            entryBId: m.entryBId,
            isBye: m.isBye,
            winnerEntryId: winner,
            decidedAt: m.isBye ? p.now : null,
        })
        if (winner && rounds > 1) {
            const next = nextSlot(1, m.position)
            const key = `${next.round}:${next.position}`
            const slot = later.get(key) ?? { entryAId: null, entryBId: null }
            if (next.side === 'A') slot.entryAId = winner
            else slot.entryBId = winner
            later.set(key, slot)
        }
    }
    for (let round = 2; round <= rounds; round += 1) {
        for (let position = 1; position <= size / 2 ** round; position += 1) {
            const slot = later.get(`${round}:${position}`)
            rows.push({
                divisionId: p.divisionId,
                tournamentId: p.tournamentId,
                round,
                position,
                entryAId: slot?.entryAId ?? null,
                entryBId: slot?.entryBId ?? null,
                isBye: false,
                winnerEntryId: null,
                decidedAt: null,
            })
        }
    }
    await tx.tournamentMatch.createMany({ data: rows })
    return { drawNo: division.drawNo, entries: entries.length }
}

// «Жеребьёвка» / «Пережеребить» of one division (WEIGH_IN or RUNNING).
export const drawDivision = async (
    prisma: PrismaService,
    p: { tournamentId: string; divisionId: string; now: Date },
): Promise<{ drawNo: number; entries: number }> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (status === 'FINISHED') throw new TournamentPublishedError()
        if (status === 'SETUP') {
            throw new BadRequestError({ message: 'Сетки собираются после начала взвешивания' })
        }
        await lockDivisions(tx, [p.divisionId])
        return drawLocked(tx, p)
    })

// Phase changes (§2.1): SETUP ↔ WEIGH_IN → RUNNING. The start withdraws
// everyone not weighed («Не взвешен») and draws every undrawn division with
// eligible entries; it is refused while a weighed entry has no division.
export const setTournamentStatus = async (
    prisma: PrismaService,
    p: { tournamentId: string; to: 'SETUP' | 'WEIGH_IN' | 'RUNNING'; now: Date },
): Promise<{ from: TournamentStatusName; withdrawn: number; drawn: number }> =>
    prisma.$transaction(
        async (tx) => {
            const { status: from } = await lockTournament(tx, p.tournamentId)
            if (from === p.to) return { from, withdrawn: 0, drawn: 0 }
            const allowed =
                (from === 'SETUP' && p.to === 'WEIGH_IN') ||
                (from === 'WEIGH_IN' && (p.to === 'SETUP' || p.to === 'RUNNING'))
            if (!allowed) {
                if (from === 'FINISHED') throw new TournamentPublishedError()
                throw new BadRequestError({
                    message:
                        from === 'RUNNING'
                            ? 'Турнир уже идёт — вернуть приём заявок или взвешивание нельзя'
                            : 'Сначала начните взвешивание',
                })
            }
            let withdrawn = 0
            let drawn = 0
            if (p.to === 'RUNNING') {
                const unassigned = await tx.tournamentEntry.count({
                    where: {
                        tournamentId: p.tournamentId,
                        status: 'CONFIRMED',
                        weighedWeightG: { not: null },
                        divisionId: null,
                    },
                })
                if (unassigned > 0) throw new TournamentUnassignedError(unassigned)
                const divisions = await tx.tournamentDivision.findMany({
                    where: { tournamentId: p.tournamentId, drawnAt: null },
                    select: { id: true, name: true },
                    orderBy: { sortOrder: 'asc' },
                })
                const sizes = await tx.tournamentEntry.groupBy({
                    by: ['divisionId'],
                    where: {
                        tournamentId: p.tournamentId,
                        status: 'CONFIRMED',
                        weighedWeightG: { not: null },
                        divisionId: { in: divisions.map((d) => d.id) },
                    },
                    _count: { _all: true },
                })
                const sizeOf = new Map(sizes.map((s) => [s.divisionId, s._count._all]))
                const tooBig = divisions.filter((d) => (sizeOf.get(d.id) ?? 0) > MAX_DRAW_ENTRIES)
                if (tooBig.length > 0) {
                    throw new BadRequestError({
                        message: `Разделите ${pluralRu(tooBig.length, 'категорию', 'категории', 'категорий')}: ${tooBig
                            .map((d) => d.name)
                            .join(', ')} (больше ${MAX_DRAW_ENTRIES} участников)`,
                    })
                }
                // Not weighed = not in the brackets; a DECLARED entry was never
                // weighed either (the weigher confirms at the scale).
                withdrawn = (
                    await tx.tournamentEntry.updateMany({
                        where: {
                            tournamentId: p.tournamentId,
                            status: { in: ['DECLARED', 'CONFIRMED'] },
                            weighedWeightG: null,
                        },
                        data: { status: 'WITHDRAWN', withdrawnReason: NOT_WEIGHED_REASON },
                    })
                ).count
                for (const d of divisions) {
                    if (!sizeOf.get(d.id)) continue
                    await lockDivisions(tx, [d.id])
                    await drawLocked(tx, {
                        tournamentId: p.tournamentId,
                        divisionId: d.id,
                        now: p.now,
                    })
                    drawn += 1
                }
            }
            // Back to taking entries: the club may cancel, re-declare or be
            // confirmed into another division, and none of that touches a
            // bracket. So every bracket drawn during the weigh-in goes (no
            // result can exist before RUNNING); the start draws again.
            if (p.to === 'SETUP') {
                const drawnDivisions = await tx.tournamentDivision.findMany({
                    where: { tournamentId: p.tournamentId, drawnAt: { not: null } },
                    select: { id: true },
                })
                await lockDivisions(tx, drawnDivisions.map((d) => d.id))
                for (const d of drawnDivisions) await clearBracket(tx, d.id)
            }
            await tx.tournament.update({
                where: { id: p.tournamentId },
                data: { status: p.to },
                select: { id: true },
            })
            return { from, withdrawn, drawn }
        },
        { timeout: 60_000 },
    )

// «Опубликовать итоги» (RUNNING → FINISHED, every drawn division finished
// and nobody left in an undrawn one) / «Снять публикацию» (back to RUNNING).
export const setResultsPublished = async (
    prisma: PrismaService,
    p: { tournamentId: string; published: boolean; now: Date },
): Promise<{ changed: boolean }> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (!p.published) {
            if (status === 'RUNNING') return { changed: false }
            if (status !== 'FINISHED') {
                throw new BadRequestError({ message: 'Итоги ещё не опубликованы' })
            }
            await tx.tournament.update({
                where: { id: p.tournamentId },
                data: { status: 'RUNNING', resultsPublishedAt: null },
                select: { id: true },
            })
            return { changed: true }
        }
        if (status === 'FINISHED') return { changed: false }
        if (status !== 'RUNNING') {
            throw new BadRequestError({ message: 'Итоги публикуют после начала турнира' })
        }
        const divisions = await tx.tournamentDivision.findMany({
            where: { tournamentId: p.tournamentId, finishedAt: null },
            select: {
                id: true,
                drawnAt: true,
                // Drawable entrants only: an unweighed entry returned after
                // the start can never be drawn and must not block publishing.
                _count: {
                    select: {
                        entries: { where: { status: 'CONFIRMED', weighedWeightG: { not: null } } },
                    },
                },
            },
        })
        const unfinished = divisions.filter((d) => d.drawnAt !== null || d._count.entries > 0)
        if (unfinished.length > 0) {
            throw new BadRequestError({
                message: `Не закончены: ${unfinished.length} ${pluralRu(unfinished.length, 'категория', 'категории', 'категорий')}`,
            })
        }
        await tx.tournament.update({
            where: { id: p.tournamentId },
            data: { status: 'FINISHED', resultsPublishedAt: p.now },
            select: { id: true },
        })
        return { changed: true }
    })

export type ResultInput = {
    winnerEntryId: string
    method: MethodName
    scoreA: number | null
    scoreB: number | null
    note: string | null
}

export type StoredResult = ResultInput & { matchId: string }

const sameResult = (
    m: { winnerEntryId: string | null; method: string | null; scoreA: number | null; scoreB: number | null },
    r: ResultInput,
): boolean =>
    m.winnerEntryId === r.winnerEntryId &&
    m.method === r.method &&
    m.scoreA === r.scoreA &&
    m.scoreB === r.scoreB

const loadMatch = (tx: Tx, tournamentId: string, matchId: string) =>
    tx.tournamentMatch.findFirst({ where: { id: matchId, tournamentId } })

// Places once the final is decided (§4.2), written to the entries.
const settlePlaces = async (
    tx: Tx,
    divisionId: string,
    now: Date,
): Promise<boolean> => {
    const matches = await tx.tournamentMatch.findMany({
        where: { divisionId },
        select: {
            round: true,
            position: true,
            entryAId: true,
            entryBId: true,
            isBye: true,
            winnerEntryId: true,
            method: true,
        },
    })
    const entryIds = [
        ...new Set(
            matches
                .filter((m) => m.round === 1)
                .flatMap((m) => [m.entryAId, m.entryBId])
                .filter((id): id is string => id !== null),
        ),
    ]
    const places = placingsFor(matches, entryIds)
    if (places.size === 0) return false
    await tx.tournamentEntry.updateMany({ where: { divisionId }, data: { place: null } })
    for (const [entryId, place] of places) {
        await tx.tournamentEntry.update({
            where: { id: entryId },
            data: { place },
            select: { id: true },
        })
    }
    await tx.tournamentDivision.update({
        where: { id: divisionId },
        data: { finishedAt: now },
        select: { id: true },
    })
    return true
}

// The table records a match: the winner goes on into the next round; the
// final settles places. A decided match: an identical retry (a tablet's
// Wi-Fi blip) returns as is whatever `expectedUpdatedAt` says; a different
// result is STALE_UPDATE («Результат уже записан с другого планшета»).
export const recordResult = async (
    prisma: PrismaService,
    p: {
        tournamentId: string
        matchId: string
        result: ResultInput
        expectedUpdatedAt: string | undefined
        actorId: string
        now: Date
    },
): Promise<{ divisionId: string; round: number; position: number; retried: boolean; finished: boolean }> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        const head = await loadMatch(tx, p.tournamentId, p.matchId)
        if (!head) throw new NotFoundError({ message: 'Пара не найдена' })
        if (status === 'FINISHED') throw new TournamentPublishedError()
        if (status !== 'RUNNING') {
            throw new BadRequestError({ message: 'Результаты записывают после начала турнира' })
        }
        await lockDivisions(tx, [head.divisionId])
        const match = (await loadMatch(tx, p.tournamentId, p.matchId))!
        const base = { divisionId: match.divisionId, round: match.round, position: match.position }
        if (match.winnerEntryId !== null && !match.isBye) {
            if (sameResult(match, p.result)) return { ...base, retried: true, finished: false }
            throw new StaleUpdateError({
                message: RESULT_ALREADY_RECORDED,
                metadata: {
                    winnerEntryId: match.winnerEntryId,
                    method: match.method,
                    scoreA: match.scoreA,
                    scoreB: match.scoreB,
                    decidedAt: match.decidedAt?.toISOString() ?? null,
                },
            })
        }
        if (match.isBye || match.entryAId === null || match.entryBId === null) {
            throw new BadRequestError({ message: 'Пара ещё не готова: соперник неизвестен' })
        }
        if (p.result.winnerEntryId !== match.entryAId && p.result.winnerEntryId !== match.entryBId) {
            throw new BadRequestError({ message: 'Победитель должен быть участником пары' })
        }
        // «По очкам»: both scores, the winner's higher.
        if (p.result.method === 'POINTS') {
            const winnerIsA = p.result.winnerEntryId === match.entryAId
            const [won, lost] = winnerIsA
                ? [p.result.scoreA, p.result.scoreB]
                : [p.result.scoreB, p.result.scoreA]
            if (won === null || lost === null) {
                throw new BadRequestError({ message: 'Для победы по очкам укажите счёт обоих участников' })
            }
            if (won <= lost) {
                throw new BadRequestError({ message: 'По очкам побеждает тот, у кого очков больше' })
            }
        }
        await claimUnchanged(p.expectedUpdatedAt, (expected) =>
            tx.tournamentMatch.updateMany({
                where: { id: match.id, updatedAt: expected },
                data: { updatedAt: p.now },
            }),
        )
        await tx.tournamentMatch.update({
            where: { id: match.id },
            data: {
                winnerEntryId: p.result.winnerEntryId,
                method: p.result.method,
                scoreA: p.result.scoreA,
                scoreB: p.result.scoreB,
                note: p.result.note,
                decidedAt: p.now,
                decidedById: p.actorId,
            },
            select: { id: true },
        })
        const next = nextSlot(match.round, match.position)
        const downstream = await tx.tournamentMatch.findUnique({
            where: {
                divisionId_round_position: {
                    divisionId: match.divisionId,
                    round: next.round,
                    position: next.position,
                },
            },
            select: { id: true },
        })
        if (downstream) {
            await tx.tournamentMatch.update({
                where: { id: downstream.id },
                data: next.side === 'A'
                    ? { entryAId: p.result.winnerEntryId }
                    : { entryBId: p.result.winnerEntryId },
                select: { id: true },
            })
            return { ...base, retried: false, finished: false }
        }
        const finished = await settlePlaces(tx, match.divisionId, p.now)
        return { ...base, retried: false, finished }
    })

// Undo at the frontier only (§4.4): never after publication, never while the
// match the winner went to is decided. Clears the result, the winner's slot
// downstream, the division's places and finishedAt.
export const undoResult = async (
    prisma: PrismaService,
    p: {
        tournamentId: string
        matchId: string
        expectedUpdatedAt: string | undefined
        now: Date
    },
): Promise<{ divisionId: string; round: number; position: number; previous: Omit<ResultInput, 'note'> }> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        const head = await loadMatch(tx, p.tournamentId, p.matchId)
        if (!head) throw new NotFoundError({ message: 'Пара не найдена' })
        if (status === 'FINISHED') throw new TournamentPublishedError()
        if (status !== 'RUNNING') {
            throw new BadRequestError({ message: 'Результаты отменяют, пока турнир идёт' })
        }
        await lockDivisions(tx, [head.divisionId])
        const match = (await loadMatch(tx, p.tournamentId, p.matchId))!
        if (match.isBye) {
            throw new BadRequestError({ message: 'Проход без соперника не отменяется — пережеребьте категорию' })
        }
        if (match.winnerEntryId === null || match.method === null) {
            throw new BadRequestError({ message: 'Результат этой пары не записан' })
        }
        const next = nextSlot(match.round, match.position)
        const downstream = await tx.tournamentMatch.findUnique({
            where: {
                divisionId_round_position: {
                    divisionId: match.divisionId,
                    round: next.round,
                    position: next.position,
                },
            },
            select: { id: true, winnerEntryId: true },
        })
        if (downstream?.winnerEntryId) {
            throw new MatchUndoBlockedError(
                'Сначала отмените результат следующего круга — победитель уже выступил в нём',
            )
        }
        await claimUnchanged(p.expectedUpdatedAt, (expected) =>
            tx.tournamentMatch.updateMany({
                where: { id: match.id, updatedAt: expected },
                data: { updatedAt: p.now },
            }),
        )
        const previous = {
            winnerEntryId: match.winnerEntryId,
            method: match.method,
            scoreA: match.scoreA,
            scoreB: match.scoreB,
        }
        await tx.tournamentMatch.update({
            where: { id: match.id },
            data: {
                winnerEntryId: null,
                method: null,
                scoreA: null,
                scoreB: null,
                note: null,
                decidedAt: null,
                decidedById: null,
            },
            select: { id: true },
        })
        if (downstream) {
            await tx.tournamentMatch.update({
                where: { id: downstream.id },
                data: next.side === 'A' ? { entryAId: null } : { entryBId: null },
                select: { id: true },
            })
        }
        await tx.tournamentEntry.updateMany({
            where: { divisionId: match.divisionId },
            data: { place: null },
        })
        await tx.tournamentDivision.update({
            where: { id: match.divisionId },
            data: { finishedAt: null },
            select: { id: true },
        })
        return {
            divisionId: match.divisionId,
            round: match.round,
            position: match.position,
            previous,
        }
    })

// Changing who is in a division (move, withdrawal, a first weigh-in) drops
// its bracket while it has no results (a new draw follows); with results it
// is refused.
const releaseDivision = async (tx: Tx, divisionId: string | null): Promise<void> => {
    if (!divisionId) return
    const d = await tx.tournamentDivision.findUniqueOrThrow({
        where: { id: divisionId },
        select: { drawnAt: true },
    })
    if (!d.drawnAt) return
    if (await hasResults(tx, divisionId)) {
        throw new DivisionHasResultsError(
            'В категории уже есть результаты — состав менять нельзя',
        )
    }
    await clearBracket(tx, divisionId)
}

// Moves an entry between divisions (SETUP / WEIGH_IN; RUNNING only while
// neither division has results — both brackets then need a new draw).
export const moveEntry = async (
    prisma: PrismaService,
    p: { tournamentId: string; entryId: string; toDivisionId: string },
): Promise<{ fromDivisionId: string | null; cleared: boolean }> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (status === 'FINISHED') throw new TournamentPublishedError()
        const entry = await tx.tournamentEntry.findFirst({
            where: { id: p.entryId, tournamentId: p.tournamentId },
            select: { divisionId: true, status: true, weighedWeightG: true },
        })
        if (!entry) throw new NotFoundError({ message: 'Участник не найден' })
        const to = await tx.tournamentDivision.findFirst({
            where: { id: p.toDivisionId, tournamentId: p.tournamentId },
            select: { id: true },
        })
        if (!to) throw new NotFoundError({ message: 'Категория не найдена' })
        if (entry.divisionId === to.id) return { fromDivisionId: entry.divisionId, cleared: false }
        await lockDivisions(tx, [to.id, ...(entry.divisionId ? [entry.divisionId] : [])])
        // A bracket changes only when the entry would be drawn in it.
        const counts = entry.status === 'CONFIRMED' && entry.weighedWeightG !== null
        if (counts) {
            await releaseDivision(tx, entry.divisionId)
            await releaseDivision(tx, to.id)
        }
        await tx.tournamentEntry.update({
            where: { id: p.entryId },
            data: { divisionId: to.id, place: null },
            select: { id: true },
        })
        return { fromDivisionId: entry.divisionId, cleared: counts }
    })

// «Снять с турнира» / return. Allowed while the division has no results (a
// drawn one is released for a new draw); after results the table records a
// walkover instead.
export const setEntryWithdrawn = async (
    prisma: PrismaService,
    p: { tournamentId: string; entryId: string; withdrawn: boolean; reason: string | null },
): Promise<void> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (status === 'FINISHED') throw new TournamentPublishedError()
        const entry = await tx.tournamentEntry.findFirst({
            where: { id: p.entryId, tournamentId: p.tournamentId },
            select: { divisionId: true, status: true, confirmedAt: true, weighedWeightG: true },
        })
        if (!entry) throw new NotFoundError({ message: 'Участник не найден' })
        const isWithdrawn = entry.status === 'WITHDRAWN'
        if (isWithdrawn === p.withdrawn) {
            if (p.withdrawn && p.reason) {
                await tx.tournamentEntry.update({
                    where: { id: p.entryId },
                    data: { withdrawnReason: p.reason },
                    select: { id: true },
                })
            }
            return
        }
        if (entry.divisionId) {
            await lockDivisions(tx, [entry.divisionId])
            const drawnCounts = p.withdrawn
                ? entry.status === 'CONFIRMED' && entry.weighedWeightG !== null
                : entry.confirmedAt !== null && entry.weighedWeightG !== null
            if (drawnCounts) await releaseDivision(tx, entry.divisionId)
        }
        await tx.tournamentEntry.update({
            where: { id: p.entryId },
            data: p.withdrawn
                ? { status: 'WITHDRAWN', withdrawnReason: p.reason, place: null }
                : {
                      status: entry.confirmedAt ? 'CONFIRMED' : 'DECLARED',
                      withdrawnReason: null,
                  },
            select: { id: true },
        })
    })

// The weigh-in (WEIGH_IN only): records the weight; a DECLARED entry is
// confirmed by the weigher (the federation's call at the scale). A first
// weight makes the entry drawable, so a drawn division is released.
export const recordWeighIn = async (
    prisma: PrismaService,
    p: {
        tournamentId: string
        entryId: string
        weighedWeightG: number
        actorId: string
        now: Date
        // Set when the entry has no division and exactly one fits.
        assignDivisionId: string | null
    },
): Promise<void> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (status !== 'WEIGH_IN') {
            throw new BadRequestError({
                message:
                    status === 'SETUP'
                        ? 'Взвешивание ещё не началось'
                        : 'Взвешивание закончено — турнир уже идёт',
            })
        }
        const entry = await tx.tournamentEntry.findFirst({
            where: { id: p.entryId, tournamentId: p.tournamentId },
            select: { divisionId: true, status: true, weighedWeightG: true },
        })
        if (!entry) throw new NotFoundError({ message: 'Участник не найден' })
        if (entry.status === 'WITHDRAWN') {
            throw new BadRequestError({ message: 'Участник снят с турнира — сначала верните его' })
        }
        const divisionId = entry.divisionId ?? p.assignDivisionId
        if (divisionId) {
            await lockDivisions(tx, [divisionId])
            const becomesDrawable = entry.status !== 'CONFIRMED' || entry.weighedWeightG === null
            if (becomesDrawable) await releaseDivision(tx, divisionId)
        }
        await tx.tournamentEntry.update({
            where: { id: p.entryId },
            data: {
                weighedWeightG: p.weighedWeightG,
                weighedAt: p.now,
                weighedById: p.actorId,
                divisionId,
                ...(entry.status === 'DECLARED'
                    ? { status: 'CONFIRMED', confirmedById: p.actorId, confirmedAt: p.now }
                    : {}),
            },
            select: { id: true },
        })
    })

export type EntryConfirmation = {
    confirmedById: string
    templateLevelId: string | null
    levelName: string | null
    // null = the level came from the registry.
    levelSetById: string | null
    divisionId: string | null
}

// A club-side declaration (SETUP only, under the tournament lock so it can't
// slip in after «Начать взвешивание»). Self: DECLARED, and a changed weight,
// sex or birth year resets a confirmation. A coach: CONFIRMED at once.
export const declareEntry = async (
    prisma: PrismaService,
    p: {
        tournamentId: string
        registrationId: string
        userId: string
        workspaceId: string
        sex: 'FEMALE' | 'MALE'
        birthYear: number
        declaredWeightG: number
        declaredById: string
        confirmation: EntryConfirmation | null
        now: Date
    },
): Promise<{ entryId: string; created: boolean }> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (status !== 'SETUP') throw new TournamentLockedError()
        const existing = await tx.tournamentEntry.findUnique({
            where: { registrationId: p.registrationId },
            select: {
                id: true,
                status: true,
                sex: true,
                birthYear: true,
                declaredWeightG: true,
            },
        })
        // The federation took it off the tournament: the club can't revive it.
        if (existing?.status === 'WITHDRAWN') {
            throw new BadRequestError({ message: 'Заявка снята' })
        }
        const facts = {
            sex: p.sex,
            birthYear: p.birthYear,
            declaredWeightG: p.declaredWeightG,
            declaredById: p.declaredById,
        }
        const confirmed = p.confirmation
            ? {
                  status: 'CONFIRMED' as const,
                  confirmedById: p.confirmation.confirmedById,
                  confirmedAt: p.now,
                  templateLevelId: p.confirmation.templateLevelId,
                  levelName: p.confirmation.levelName,
                  levelSetById: p.confirmation.levelSetById,
                  divisionId: p.confirmation.divisionId,
                  withdrawnReason: null,
              }
            : null
        if (!existing) {
            const row = await tx.tournamentEntry.create({
                data: {
                    tournamentId: p.tournamentId,
                    registrationId: p.registrationId,
                    userId: p.userId,
                    workspaceId: p.workspaceId,
                    ...facts,
                    ...(confirmed ?? { status: 'DECLARED' as const }),
                },
                select: { id: true },
            })
            return { entryId: row.id, created: true }
        }
        const unchanged =
            existing.sex === p.sex &&
            existing.birthYear === p.birthYear &&
            existing.declaredWeightG === p.declaredWeightG
        const keepConfirmation = existing.status === 'CONFIRMED' && unchanged
        await tx.tournamentEntry.update({
            where: { id: existing.id },
            data: {
                ...facts,
                ...(confirmed ??
                    (keepConfirmation
                        ? {}
                        : {
                              status: 'DECLARED' as const,
                              confirmedById: null,
                              confirmedAt: null,
                              divisionId: null,
                              withdrawnReason: null,
                              // A weight taken before «Вернуть приём заявок»
                              // belongs to the old declaration: weigh again.
                              weighedWeightG: null,
                              weighedAt: null,
                              weighedById: null,
                          })),
            },
            select: { id: true },
        })
        return { entryId: existing.id, created: false }
    })

// The coach confirms a DECLARED entry (SETUP only): level snapshot and the
// matching division. Re-confirming a confirmed one refreshes both.
export const confirmEntry = async (
    prisma: PrismaService,
    p: { tournamentId: string; entryId: string; confirmation: EntryConfirmation; now: Date },
): Promise<void> =>
    prisma.$transaction(async (tx) => {
        const { status } = await lockTournament(tx, p.tournamentId)
        if (status !== 'SETUP') throw new TournamentLockedError()
        const entry = await tx.tournamentEntry.findUnique({
            where: { id: p.entryId },
            select: { status: true },
        })
        if (!entry) throw new NotFoundError({ message: 'Заявка не найдена' })
        if (entry.status === 'WITHDRAWN') {
            throw new BadRequestError({ message: 'Заявка снята' })
        }
        await tx.tournamentEntry.update({
            where: { id: p.entryId },
            data: {
                status: 'CONFIRMED',
                confirmedById: p.confirmation.confirmedById,
                confirmedAt: p.now,
                templateLevelId: p.confirmation.templateLevelId,
                levelName: p.confirmation.levelName,
                levelSetById: p.confirmation.levelSetById,
                divisionId: p.confirmation.divisionId,
            },
            select: { id: true },
        })
    })

// Cancelling a registration (SETUP only) takes its entry with it; after
// SETUP the club can't (TOURNAMENT_LOCKED — changes through the secretary).
// Runs inside the cancellation's transaction, so a declaration can't land
// between the entry going and the booking being cancelled.
export const releaseRegistrationEntryIn = async (
    tx: Tx,
    p: { eventId: string; registrationId: string },
): Promise<void> => {
    const t = await tx.tournament.findUnique({
        where: { eventId: p.eventId },
        select: { id: true },
    })
    if (!t) return
    const { status } = await lockTournament(tx, t.id)
    if (status !== 'SETUP') throw new TournamentLockedError()
    await tx.tournamentEntry.deleteMany({ where: { registrationId: p.registrationId } })
}
