jest.mock('../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import { environment as env } from '../../environments/environment'
import type { PushNotificationRow } from '../notifications/services/notification-producer.service'
import {
    dispatchBracketReady,
    dispatchResultsPublished,
    dispatchTournamentPushes,
    notifyMatchSoon,
    purgeTournamentWeights,
    RESULTS_LOOKBACK_MS,
    WEIGHT_RETENTION_MS,
} from './tournament-dispatch'

// 05:00 UTC: 12:00 in Tomsk (awake), 08:00 in Moscow (quiet until 09:00).
const NOW = new Date('2026-12-20T05:00:00Z')

const pushEntry = (id: string, tz: string, o: Record<string, unknown> = {}, orgType = 'GRAPPLING') => ({
    id,
    userId: `user-${id}`,
    workspaceId: `club-${id}`,
    place: null as number | null,
    workspace: { timezone: tz },
    division: { name: 'Мужчины · до 76 кг', mat: 2, drawNo: 1 },
    tournament: {
        id: 't1',
        organizationId: 'org1',
        eventId: 'ev1',
        event: { title: 'Кубок федерации' },
        organization: { type: orgType },
    },
    ...o,
})

const build = (o: { entries?: unknown[]; claimed?: string[]; divisions?: unknown[]; matches?: unknown[] } = {}) => {
    const claimed = new Set(o.claimed ?? [])
    const prisma = {
        tournamentEntry: {
            findMany: jest.fn().mockResolvedValue(o.entries ?? []),
            updateMany: jest.fn().mockResolvedValue({ count: 3 }),
        },
        tournamentDivision: { findMany: jest.fn().mockResolvedValue(o.divisions ?? []) },
        tournamentMatch: { findMany: jest.fn().mockResolvedValue(o.matches ?? []) },
        notificationDispatchLog: {
            // The minute job reads what is claimed before claiming.
            findMany: jest.fn(async ({ where }: { where: { kind: string; refId: { in: string[] } } }) =>
                where.refId.in
                    .filter((refId) => claimed.has(`${where.kind}/${refId}`))
                    .map((refId) => ({ refId })),
            ),
            createManyAndReturn: jest.fn(async ({ data }: { data: Array<{ kind: string; refId: string }> }) =>
                data
                    .filter((d) => !claimed.has(`${d.kind}/${d.refId}`))
                    .map((d) => {
                        claimed.add(`${d.kind}/${d.refId}`)
                        return { refId: d.refId }
                    }),
            ),
        },
    }
    const rows: PushNotificationRow[] = []
    const notifications = {
        writeMany: jest.fn(async (batch: PushNotificationRow[]) => {
            rows.push(...batch)
            return batch.length
        }),
    }
    return { prisma, notifications, rows }
}

beforeEach(() => {
    env.organizations.enabled = true
})

describe('bracket_ready', () => {
    it('reaches awake entrants of drawn divisions once per draw; a quiet club waits', async () => {
        const { prisma, notifications, rows } = build({
            entries: [pushEntry('tomsk', 'Asia/Tomsk'), pushEntry('msk', 'Europe/Moscow')],
        })
        await expect(dispatchBracketReady(prisma as never, notifications, NOW)).resolves.toBe(1)
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toEqual({
            status: 'CONFIRMED',
            // in a bracket: weighed (an entry returned after the draw isn't)
            weighedWeightG: { not: null },
            // bounded: a bracket drawn before the lookback was announced already
            division: { drawnAt: { gt: new Date(NOW.getTime() - RESULTS_LOOKBACK_MS) } },
            tournament: { status: 'RUNNING', organization: { isActive: true } },
        })
        expect(rows).toEqual([
            {
                userId: 'user-tomsk',
                topic: 'Сетки готовы',
                message: 'Мужчины · до 76 кг, ковёр 2',
                metadata: {
                    kind: 'tournament.bracket_ready',
                    workspaceId: 'club-tomsk',
                    organizationId: 'org1',
                    eventId: 'ev1',
                    tournamentId: 't1',
                },
            },
        ])
        expect(prisma.notificationDispatchLog.createManyAndReturn.mock.calls[0][0].data).toEqual([
            { kind: 'tournament.bracket_ready', refId: 'tomsk:1' },
        ])

        // the next run: Tomsk was claimed, Moscow is awake at 09:00
        rows.length = 0
        const morning = new Date('2026-12-20T06:00:00Z')
        await dispatchBracketReady(prisma as never, notifications, morning)
        expect(rows.map((r) => r.userId)).toEqual(['user-msk'])
    })

    it('a redraw (drawNo + 1) is news again; a division without a mat says so by omission', async () => {
        const { prisma, notifications, rows } = build({
            claimed: ['tournament.bracket_ready/a:1'],
            entries: [pushEntry('a', 'Asia/Tomsk', { division: { name: 'Абсолютная', mat: null, drawNo: 2 } })],
        })
        await dispatchBracketReady(prisma as never, notifications, NOW)
        expect(rows).toEqual([expect.objectContaining({ userId: 'user-a', message: 'Абсолютная' })])
    })

    it('reads the claims first and writes nothing when every entrant was told already', async () => {
        const { prisma, notifications } = build({
            claimed: ['tournament.bracket_ready/a:1'],
            entries: [pushEntry('a', 'Asia/Tomsk')],
        })
        await expect(dispatchBracketReady(prisma as never, notifications, NOW)).resolves.toBe(0)
        expect(prisma.notificationDispatchLog.findMany.mock.calls[0][0].where).toEqual({
            kind: 'tournament.bracket_ready',
            refId: { in: ['a:1'] },
        })
        expect(prisma.notificationDispatchLog.createManyAndReturn).not.toHaveBeenCalled()
        expect(notifications.writeMany).not.toHaveBeenCalled()
    })
})

describe('results_published', () => {
    it('tells each entrant their place, holding a quiet club until 09:00', async () => {
        const { prisma, notifications, rows } = build({
            entries: [
                pushEntry('gold', 'Asia/Tomsk', { place: 2 }),
                pushEntry('none', 'Asia/Tomsk'),
                pushEntry('msk', 'Europe/Moscow', { place: 1 }),
            ],
        })
        await expect(dispatchResultsPublished(prisma as never, notifications, NOW)).resolves.toBe(2)
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toEqual({
            status: 'CONFIRMED',
            tournament: {
                status: 'FINISHED',
                resultsPublishedAt: { gt: new Date(NOW.getTime() - RESULTS_LOOKBACK_MS), lte: NOW },
                organization: { isActive: true },
            },
        })
        expect(rows.map((r) => [r.userId, r.topic, r.message])).toEqual([
            ['user-gold', 'Итоги «Кубок федерации»', '2 место'],
            ['user-none', 'Итоги «Кубок федерации»', 'Итоги опубликованы'],
        ])
        expect(rows[0].metadata).toMatchObject({ kind: 'tournament.results_published', tournamentId: 't1' })
        expect(prisma.notificationDispatchLog.createManyAndReturn.mock.calls[0][0].data).toEqual([
            { kind: 'tournament.results_published', refId: 'gold' },
            { kind: 'tournament.results_published', refId: 'none' },
        ])

        rows.length = 0
        await dispatchResultsPublished(prisma as never, notifications, new Date('2026-12-20T06:01:00Z'))
        expect(rows.map((r) => [r.userId, r.message])).toEqual([['user-msk', '1 место']])
    })
})

describe('weight retention', () => {
    it('clears both weights 30 days after publication or after the event end, nothing else', async () => {
        const { prisma } = build()
        const before = new Date(NOW.getTime() - WEIGHT_RETENTION_MS)
        await expect(purgeTournamentWeights(prisma as never, NOW)).resolves.toBe(3)
        expect(prisma.tournamentEntry.updateMany).toHaveBeenCalledWith({
            where: {
                AND: [
                    { OR: [{ declaredWeightG: { not: null } }, { weighedWeightG: { not: null } }] },
                    {
                        OR: [
                            { tournament: { resultsPublishedAt: { lte: before } } },
                            // never published, abandoned or unpublished: the event's end
                            // (its start without an end) — a republish can't restart it
                            { tournament: { event: { endAt: { lte: before } } } },
                            { tournament: { event: { endAt: null, startAt: { lte: before } } } },
                        ],
                    },
                ],
            },
            data: { declaredWeightG: null, weighedWeightG: null },
        })
        expect(WEIGHT_RETENTION_MS).toBe(30 * 24 * 3_600_000)
    })
})

describe('the minute job', () => {
    it('runs all three and reports the counts', async () => {
        const { prisma, notifications } = build({ entries: [pushEntry('a', 'Asia/Tomsk', { place: 1 })] })
        await expect(dispatchTournamentPushes(prisma as never, notifications, NOW)).resolves.toEqual({
            bracketReady: 1,
            resultsPublished: 1,
            weightsPurged: 3,
        })
    })

    it('does nothing with the federation hub off', async () => {
        env.organizations.enabled = false
        const { prisma, notifications } = build({ entries: [pushEntry('a', 'Asia/Tomsk')] })
        await expect(dispatchTournamentPushes(prisma as never, notifications, NOW)).resolves.toEqual({
            bracketReady: 0,
            resultsPublished: 0,
            weightsPurged: 0,
        })
        expect(prisma.tournamentEntry.findMany).not.toHaveBeenCalled()
        expect(prisma.tournamentEntry.updateMany).not.toHaveBeenCalled()
    })
})

describe('match_soon', () => {
    const divisions = [
        { id: 'd1', sortOrder: 1, mat: 2, matOrder: 1 },
        { id: 'd2', sortOrder: 2, mat: 2, matOrder: 2 },
    ]
    const m = (id: string, divisionId: string, round: number, position: number, a: string | null, b: string | null, winner: string | null = null) => ({
        id,
        divisionId,
        round,
        position,
        entryAId: a,
        entryBId: b,
        isBye: false,
        winnerEntryId: winner,
    })
    const matches = [
        m('done', 'd1', 1, 1, 'x', 'y', 'x'),
        m('next', 'd1', 1, 2, 'a', 'b'),
        m('waiting', 'd1', 2, 1, 'x', null),
        m('then', 'd2', 1, 1, 'c', 'msk'),
        m('later', 'd2', 1, 2, 'e', 'f'),
    ]

    it('tells the entrants of matches with fewer than two in front; quiet ones are dropped, not held', async () => {
        const { prisma, notifications, rows } = build({
            divisions,
            matches,
            entries: [pushEntry('a', 'Asia/Tomsk'), pushEntry('b', 'Europe/Moscow')],
        })
        await expect(
            notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: 2, now: NOW }),
        ).resolves.toBe(1)
        // «then» (d2) waits behind d1's open match and its not-yet-ready final:
        // two in front, so c and msk hear nothing yet.
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toEqual({
            id: { in: ['a', 'b'] },
        })
        expect(rows).toEqual([
            expect.objectContaining({
                userId: 'user-a',
                topic: 'Скоро ваша схватка',
                message: 'Ковёр 2, ваша схватка следующая',
                metadata: expect.objectContaining({ kind: 'tournament.match_soon', eventId: 'ev1', workspaceId: 'club-a' }),
            }),
        ])
        // the quiet entrant is not claimed: nothing is queued for the morning
        expect(prisma.notificationDispatchLog.createManyAndReturn.mock.calls[0][0].data).toEqual([
            { kind: 'tournament.match_soon', refId: 'next:a' },
        ])
    })

    it('counts in the discipline’s words and reaches the next division once one match is left', async () => {
        const finalOnly = [
            m('done', 'd1', 1, 1, 'x', 'y', 'x'),
            m('next', 'd1', 1, 2, 'a', 'b', 'a'),
            m('final', 'd1', 2, 1, 'x', 'a'),
            m('then', 'd2', 1, 1, 'c', 'd'),
        ]
        const { prisma, notifications, rows } = build({
            divisions,
            matches: finalOnly,
            entries: ['x', 'a', 'c', 'd'].map((id) => pushEntry(id, 'Asia/Tomsk', {}, 'FITNESS')),
        })
        await notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: 2, now: NOW })
        expect(rows.map((r) => [r.userId, r.topic, r.message])).toEqual([
            ['user-x', 'Скоро ваше выступление', 'Ковёр 2, ваше выступление следующее'],
            ['user-a', 'Скоро ваше выступление', 'Ковёр 2, ваше выступление следующее'],
            ['user-c', 'Скоро ваше выступление', 'Ковёр 2, перед вами 1 выступление'],
            ['user-d', 'Скоро ваше выступление', 'Ковёр 2, перед вами 1 выступление'],
        ])
    })

    it('is once per (match, entrant) across results on the mat', async () => {
        const { prisma, notifications } = build({
            divisions,
            matches,
            entries: [pushEntry('a', 'Asia/Tomsk'), pushEntry('b', 'Asia/Tomsk')],
        })
        await notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: 2, now: NOW })
        await expect(
            notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: 2, now: NOW }),
        ).resolves.toBe(0)
        expect(notifications.writeMany).toHaveBeenCalledTimes(1)
    })

    it('skips a division without a mat, an empty queue and the hub switched off', async () => {
        const { prisma, notifications } = build({ divisions, matches: [] })
        await expect(
            notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: null, now: NOW }),
        ).resolves.toBe(0)
        expect(prisma.tournamentDivision.findMany).not.toHaveBeenCalled()
        await expect(
            notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: 2, now: NOW }),
        ).resolves.toBe(0)
        expect(prisma.tournamentEntry.findMany).not.toHaveBeenCalled()
        env.organizations.enabled = false
        await expect(
            notifyMatchSoon(prisma as never, notifications, { tournamentId: 't1', mat: 2, now: NOW }),
        ).resolves.toBe(0)
    })
})
