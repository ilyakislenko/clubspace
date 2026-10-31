import { Logger } from '@nestjs/common'

import type { PushNotificationRow } from '../notifications/services/notification-producer.service'
import { DailyClubService } from './daily-club.service'

// 10:05 in Moscow (UTC+3) — the club's morning pass is due.
const NOW = new Date('2026-05-08T07:05:00Z')
const DAY = 24 * 60 * 60_000
const CLUB = { id: 'ws-1', name: 'BJJ Academy', timezone: 'Europe/Moscow', ownerId: 'own' }

const p2002 = () => Object.assign(new Error('dup'), { code: 'P2002' })

const make = (
    o: Partial<{
        zones: string[]
        clubs: (typeof CLUB)[]
        stale: unknown[]
        expiring: unknown[]
        optedOut: string[]
        logged: string[]
        runClaimed: boolean
        backfillDone: boolean
    }> = {},
) => {
    const logged = new Set(o.logged ?? [])
    const prisma = {
        workspace: {
            findMany: jest.fn(async (args: { distinct?: string[] }) =>
                args.distinct
                    ? (o.zones ?? ['Europe/Moscow']).map((timezone) => ({ timezone }))
                    : (o.clubs ?? [CLUB]),
            ),
        },
        workspaceMember: {
            findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
                'lastAttendedAt' in args.where ? (o.stale ?? []) : (o.expiring ?? []),
            ),
        },
        notificationPreferences: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.optedOut ?? []).map((userId) => ({ userId }))),
        },
        notificationDispatchLog: {
            create: jest.fn(async ({ data }: { data: { kind: string } }) => {
                if (data.kind === 'backfill.last-attended' && o.backfillDone !== false) {
                    throw p2002()
                }
                if (data.kind === 'club.daily.run' && o.runClaimed) throw p2002()
                return data
            }),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            findMany: jest.fn(async (args: { where: { refId: { in: string[] } } }) =>
                args.where.refId.in.filter((r) => logged.has(r)).map((refId) => ({ refId })),
            ),
            createManyAndReturn: jest.fn(
                async ({ data }: { data: { refId: string }[] }) =>
                    data.map((d) => ({ refId: d.refId })),
            ),
        },
        $executeRaw: jest.fn().mockResolvedValue(42),
    }
    const rows: PushNotificationRow[] = []
    const notifications = {
        writeMany: jest.fn(async (batch: PushNotificationRow[]) => {
            rows.push(...batch)
            return batch.length
        }),
    }
    const svc = new DailyClubService(prisma as never, notifications as never)
    return { svc, prisma, rows, notifications }
}

describe('DailyClubService', () => {
    let logSpies: jest.SpyInstance[]
    beforeEach(() => {
        logSpies = [
            jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
            jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
        ]
    })
    afterEach(() => logSpies.forEach((s) => s.mockRestore()))

    it('does nothing for a club outside its local morning', async () => {
        const { svc, prisma } = make({ zones: ['America/New_York'] }) // 03:05 there
        expect(await svc.run(NOW)).toEqual({
            clubs: 0,
            failed: 0,
            inactivityNotified: 0,
            accessExpiryNotified: 0,
        })
        expect(prisma.workspace.findMany).toHaveBeenCalledTimes(1)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('runs a club once a day: a second pass finds the day claimed', async () => {
        const { svc, prisma } = make({ runClaimed: true })
        expect((await svc.run(NOW)).clubs).toBe(0)
        expect(prisma.notificationDispatchLog.create).toHaveBeenCalledWith({
            data: { kind: 'club.daily.run', refId: 'ws-1:2026-05-08' },
        })
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('backfills lastAttendedAt once, before the first pass', async () => {
        const { svc, prisma } = make({ backfillDone: false })
        await svc.run(NOW)
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)

        const again = make()
        await again.svc.run(NOW)
        expect(again.prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('releases the backfill claim if the backfill fails', async () => {
        const { svc, prisma } = make({ backfillDone: false })
        prisma.$executeRaw.mockRejectedValue(new Error('lock timeout'))
        await expect(svc.run(NOW)).rejects.toThrow('lock timeout')
        expect(prisma.notificationDispatchLog.deleteMany).toHaveBeenCalledWith({
            where: { kind: 'backfill.last-attended', refId: 'v1' },
        })
    })

    describe('inactivity', () => {
        const stale = [
            { userId: 'u1', lastAttendedAt: new Date(NOW.getTime() - 20 * DAY) },
            { userId: 'u2', lastAttendedAt: new Date(NOW.getTime() - 30 * DAY) },
            { userId: 'u3', lastAttendedAt: new Date(NOW.getTime() - 40 * DAY) },
        ]
        const week = Math.floor(NOW.getTime() / (7 * DAY))

        it('reads the indexed lastAttendedAt of this club only', async () => {
            const { svc, prisma } = make()
            await svc.run(NOW)
            const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
            expect(where).toEqual({
                workspaceId: 'ws-1',
                status: 'ACTIVE',
                lastAttendedAt: { lt: new Date(NOW.getTime() - 14 * DAY) },
                OR: [{ accessUntil: null }, { accessUntil: { gt: NOW } }],
            })
        })

        it('nudges stale members, skipping opt-outs and anyone already nudged this week', async () => {
            const { svc, prisma, rows } = make({
                stale,
                optedOut: ['u2'],
                logged: [`ws-1:u3:${week}`],
            })

            const s = await svc.run(NOW)

            expect(s).toMatchObject({ clubs: 1, inactivityNotified: 1 })
            // One read of the log, then one claim for what's left.
            expect(prisma.notificationDispatchLog.findMany).toHaveBeenCalledWith({
                where: {
                    kind: 'member.inactive',
                    refId: { in: [`ws-1:u1:${week}`, `ws-1:u3:${week}`] },
                },
                select: { refId: true },
            })
            expect(
                prisma.notificationDispatchLog.createManyAndReturn.mock.calls[0][0].data,
            ).toEqual([{ kind: 'member.inactive', refId: `ws-1:u1:${week}` }])
            expect(rows).toEqual([
                {
                    userId: 'u1',
                    topic: 'Давно вас не было',
                    message:
                        'BJJ Academy: вы не отмечались на тренировках уже больше 14 дней. Ждём вас на тренировке!',
                    link: null,
                    metadata: {
                        kind: 'member.inactive',
                        workspaceId: 'ws-1',
                        lastAttendedAt: stale[0].lastAttendedAt.toISOString(),
                    },
                },
            ])
        })

        it('writes nothing when nobody is stale', async () => {
            const { svc, prisma, rows } = make()
            await svc.run(NOW)
            expect(prisma.notificationPreferences.findMany).not.toHaveBeenCalled()
            expect(rows).toHaveLength(0)
        })
    })

    describe('access expiry', () => {
        const member = (extras: Record<string, unknown> = {}) => ({
            id: 'm-1',
            userId: 'u-1',
            accessUntil: new Date(NOW.getTime() + 2 * DAY),
            subscription: null,
            ...extras,
        })

        it('warns a member whose access ends within three days', async () => {
            const { svc, prisma, rows } = make({ expiring: [member()] })

            const s = await svc.run(NOW)

            expect(s.accessExpiryNotified).toBe(1)
            const { where } = prisma.workspaceMember.findMany.mock.calls[1][0]
            expect(where).toEqual({
                workspaceId: 'ws-1',
                status: 'ACTIVE',
                accessUntil: { gt: NOW, lte: new Date(NOW.getTime() + 3 * DAY) },
            })
            expect(rows[0]).toMatchObject({
                userId: 'u-1',
                topic: 'Доступ скоро истекает',
                metadata: { kind: 'access.expiring', workspaceId: 'ws-1', memberId: 'm-1' },
            })
            expect(rows[0].message).toContain('BJJ Academy: доступ истекает 10 мая')
            expect(rows[0].message).toContain('(через 2 дн.)')
        })

        it('says «сегодня» when access ends within the day', async () => {
            const { svc, rows } = make({
                expiring: [member({ accessUntil: NOW })],
            })
            // accessUntil == now is excluded by the query; a mock returning it
            // still exercises the zero-day wording.
            await svc.run(NOW)
            expect(rows[0].message).toContain('(сегодня)')
        })

        it('skips opt-outs, a pack still waiting for its first visit, and already-warned windows', async () => {
            const { svc, rows } = make({
                expiring: [
                    member({ id: 'm-1', userId: 'opted' }),
                    member({
                        id: 'm-2',
                        userId: 'pending',
                        subscription: { status: 'ACTIVE', startDate: null },
                    }),
                    member({ id: 'm-3', userId: 'warned' }),
                ],
                optedOut: ['opted'],
                logged: [`m-3:${new Date(NOW.getTime() + 2 * DAY).toISOString().slice(0, 10)}`],
            })
            expect((await svc.run(NOW)).accessExpiryNotified).toBe(0)
            expect(rows).toHaveLength(0)
        })
    })

    it('releases the day and goes on with the next club when one club fails', async () => {
        const other = { ...CLUB, id: 'ws-2', name: 'Other' }
        const { svc, prisma } = make({ clubs: [CLUB, other] })
        prisma.workspaceMember.findMany
            .mockRejectedValueOnce(new Error('db down'))
            .mockResolvedValue([])

        const s = await svc.run(NOW)

        expect(s).toMatchObject({ clubs: 2, failed: 1 })
        expect(prisma.notificationDispatchLog.deleteMany).toHaveBeenCalledWith({
            where: { kind: 'club.daily.run', refId: 'ws-1:2026-05-08' },
        })
    })
})
