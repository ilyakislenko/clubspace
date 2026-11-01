import { Logger } from '@nestjs/common'

import { AnalyticsSnapshotService } from './analytics-snapshot.service'

const DAY = 24 * 3600_000
// Monday 2 Nov 2026, 12:00 in Tomsk.
const NOW = new Date('2026-11-02T05:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

const makePrisma = () => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk', ownerId: 'owner' }),
            findMany: jest.fn(),
        },
        workspaceMember: { findMany: jest.fn() },
        $queryRaw: jest.fn(),
        groupScheduleSlot: { findMany: jest.fn().mockResolvedValue([]) },
        scheduleException: { findMany: jest.fn().mockResolvedValue([]) },
        groupMember: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
        attendanceSession: { findMany: jest.fn().mockResolvedValue([]) },
        dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
        classOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
        classBooking: { findMany: jest.fn().mockResolvedValue([]) },
        attendanceRecord: {
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue({ id: 'r' }),
        },
        subscriptionFreeze: { findMany: jest.fn().mockResolvedValue([]) },
        analyticsMemberGroupStat: { deleteMany: jest.fn(), createMany: jest.fn() },
        analyticsSlotOccurrence: { deleteMany: jest.fn(), createMany: jest.fn() },
        analyticsMemberSnapshot: { deleteMany: jest.fn(), createMany: jest.fn() },
        analyticsRun: { upsert: jest.fn() },
        $transaction: jest.fn().mockResolvedValue([]),
    }
    return prisma
}

describe('AnalyticsSnapshotService.refreshHistory', () => {
    it('does nothing for an unknown club', async () => {
        const prisma = makePrisma()
        prisma.workspace.findUnique.mockResolvedValue(null)
        await new AnalyticsSnapshotService(prisma as never).refreshHistory('ws', NOW)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rebuilds visit spans and 26 weeks of slot classes in the gym’s timezone', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'coach' }])
        prisma.$queryRaw.mockResolvedValue([
            { userId: 'u1', groupId: 'g1', first: ago(100), last: ago(7), visits: 12 },
            { userId: 'coach', groupId: 'g1', first: ago(100), last: ago(7), visits: 30 },
            { userId: 'owner', groupId: null, first: ago(5), last: ago(5), visits: 1 },
        ])
        prisma.groupScheduleSlot.findMany.mockResolvedValue([
            {
                id: 's1',
                groupId: 'g1',
                dayOfWeek: 1,
                startTime: '19:00',
                effectiveFrom: null,
                effectiveUntil: null,
                group: { gymId: 'gym', gym: { timezone: null } },
            },
        ])
        prisma.scheduleException.findMany.mockResolvedValue([
            {
                groupId: 'g1',
                slotId: null,
                fromDate: new Date('2026-10-19T00:00:00Z'),
                untilDate: new Date('2026-10-19T00:00:00Z'),
            },
        ])
        prisma.groupMember.groupBy.mockResolvedValue([{ groupId: 'g1', _count: { _all: 12 } }])
        prisma.attendanceSession.findMany.mockResolvedValue([
            { occurrenceKey: 'slot:s1:2026-10-26', records: [{ userId: 'u1' }, { userId: 'coach' }] },
        ])
        prisma.dropInBooking.findMany.mockResolvedValue([
            { occurrenceKey: 'slot:s1:2026-10-26', userId: 'u1' },
            { occurrenceKey: 'slot:s1:2026-10-26', userId: 'u2' },
        ])

        await new AnalyticsSnapshotService(prisma as never).refreshHistory('ws', NOW)

        expect(prisma.analyticsMemberGroupStat.createMany).toHaveBeenCalledWith({
            data: [
                {
                    workspaceId: 'ws',
                    userId: 'u1',
                    groupId: 'g1',
                    firstVisitAt: ago(100),
                    lastVisitAt: ago(7),
                    visits: 12,
                },
            ],
        })
        const rows = prisma.analyticsSlotOccurrence.createMany.mock.calls[0][0].data
        const dates = rows.map((r: { sessionDate: Date }) => r.sessionDate.toISOString().slice(0, 10))
        // Mondays from 4 May to 26 Oct; today (2 Nov) has not ended, 19 Oct was cancelled.
        expect(dates[0]).toBe('2026-05-04')
        expect(dates.at(-1)).toBe('2026-10-26')
        expect(dates).not.toContain('2026-10-19')
        expect(dates).not.toContain('2026-11-02')
        expect(rows).toHaveLength(25)
        expect(rows.at(-1)).toEqual({
            workspaceId: 'ws',
            groupId: 'g1',
            slotId: 's1',
            gymId: 'gym',
            sessionDate: new Date('2026-10-26T00:00:00Z'),
            dayOfWeek: 1,
            startTime: '19:00',
            held: true,
            attended: 1,
            roster: 12,
            capacity: null,
            booked: 2,
            missedBookings: 1,
        })
        expect(rows[0]).toMatchObject({ held: false, attended: 0, booked: 0 })
        expect(prisma.analyticsRun.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: { historyComputedAt: NOW } }),
        )
    })

    it('respects a slot’s effective dates', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findMany.mockResolvedValue([])
        prisma.$queryRaw.mockResolvedValue([])
        prisma.groupScheduleSlot.findMany.mockResolvedValue([
            {
                id: 's1',
                groupId: 'g1',
                dayOfWeek: 3,
                startTime: '07:00',
                effectiveFrom: new Date('2026-10-01T00:00:00Z'),
                effectiveUntil: new Date('2026-10-21T00:00:00Z'),
                group: { gymId: null, gym: null },
            },
        ])
        await new AnalyticsSnapshotService(prisma as never).refreshHistory('ws', NOW)
        const rows = prisma.analyticsSlotOccurrence.createMany.mock.calls[0][0].data
        expect(rows.map((r: { sessionDate: Date }) => r.sessionDate.toISOString().slice(0, 10))).toEqual([
            '2026-10-07',
            '2026-10-14',
            '2026-10-21',
        ])
    })
})

describe('AnalyticsSnapshotService.refreshRisk', () => {
    const member = (userId: string, subscriptions: unknown[]) => ({
        userId,
        createdAt: ago(300),
        subscriptions,
    })
    const subRow = (over: Record<string, unknown>) => ({
        id: 'sub',
        status: 'ACTIVE',
        startDate: ago(40),
        endDate: ago(10),
        createdAt: ago(40),
        paidAt: ago(40),
        isPaid: true,
        amountPaid: 5000,
        currency: 'RUB',
        classesRemaining: null,
        durationDays: 30,
        plan: { name: '12 занятий', isFreeTrial: false, durationDays: 30 },
        directions: [],
        ...over,
    })

    it('scores every active student and stores the forecast pieces', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findMany.mockResolvedValue([
            member('gone', [subRow({})]),
            member('frozen', [subRow({ id: 'f', endDate: new Date(NOW.getTime() + 20 * DAY) })]),
        ])
        prisma.attendanceRecord.groupBy.mockResolvedValue([
            { userId: 'gone', _min: { markedAt: ago(200) }, _max: { markedAt: ago(50) } },
            { userId: 'frozen', _min: { markedAt: ago(200) }, _max: { markedAt: ago(40) } },
        ])
        prisma.subscriptionFreeze.findMany.mockResolvedValue([
            {
                userId: 'frozen',
                subscriptionId: 'f',
                untilDate: new Date('2026-11-20T00:00:00Z'),
                subscription: { status: 'ACTIVE' },
            },
        ])
        prisma.groupMember.findMany.mockResolvedValue([{ userId: 'gone', groupId: 'g1' }])
        prisma.dropInBooking.findMany.mockResolvedValue([
            { userId: 'gone', occurrenceKey: 'slot:x:2026-10-20' },
            { userId: 'gone', occurrenceKey: 'slot:x:2026-10-27' },
        ])
        prisma.attendanceRecord.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ userId: 'gone', session: { occurrenceKey: 'slot:x:2026-10-27' } }])

        await new AnalyticsSnapshotService(prisma as never).refreshRisk('ws', NOW)

        const rows = prisma.analyticsMemberSnapshot.createMany.mock.calls[0][0].data
        const gone = rows.find((r: { userId: string }) => r.userId === 'gone')
        // 40 absent + 25 expired + 6 missed booking.
        expect(gone).toMatchObject({
            score: 71,
            monthlySpend: 2500,
            currency: 'RUB',
            groupIds: ['g1'],
            firstVisitAt: ago(200),
            lastVisitAt: ago(50),
            potential30: 5000,
            // Ended 10 days ago: too fresh to judge as (not) renewed.
            renewalsDue: 0,
            renewalsDone: 0,
            computedAt: NOW,
        })
        // Default 70% (too little history) × (1 − 0.71).
        expect(gone.renewalProbability).toBeCloseTo(0.203)
        expect(gone.reasons.map((r: { code: string }) => r.code)).toEqual([
            'absent',
            'expired',
            'missed_bookings',
        ])
        const frozen = rows.find((r: { userId: string }) => r.userId === 'frozen')
        expect(frozen).toMatchObject({ score: 5, groupIds: [] })
        expect(prisma.analyticsRun.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: { riskComputedAt: NOW, clubRenewalRate: null, renewalSample: 0 },
            }),
        )
    })

    it('does nothing for an unknown club', async () => {
        const prisma = makePrisma()
        prisma.workspace.findUnique.mockResolvedValue(null)
        await new AnalyticsSnapshotService(prisma as never).refreshRisk('ws', NOW)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })
})

describe('AnalyticsSnapshotService.runScheduled', () => {
    beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined))
    afterEach(() => jest.restoreAllMocks())

    it('rebuilds history at club night or when missing/stale, scores every club, isolates failures', async () => {
        const prisma = makePrisma()
        const hourAgo = new Date(NOW.getTime() - 3600_000)
        prisma.workspace.findMany.mockResolvedValue([
            { id: 'new', timezone: 'Asia/Tomsk', analyticsRun: null },
            { id: 'fresh', timezone: 'Asia/Tomsk', analyticsRun: { historyComputedAt: hourAgo } },
            { id: 'stale', timezone: 'Asia/Tomsk', analyticsRun: { historyComputedAt: ago(2) } },
            // 04:00 in UTC-1 = 05:00 UTC: its night hour, last built 3 h ago.
            {
                id: 'night',
                timezone: 'Atlantic/Azores',
                analyticsRun: { historyComputedAt: new Date(NOW.getTime() - 3 * 3600_000) },
            },
            { id: 'broken', timezone: 'Asia/Tomsk', analyticsRun: { historyComputedAt: hourAgo } },
        ])
        const service = new AnalyticsSnapshotService(prisma as never)
        const history = jest.spyOn(service, 'refreshHistory').mockResolvedValue()
        jest.spyOn(service, 'refreshRisk').mockImplementation(async (id) => {
            if (id === 'broken') throw new Error('boom')
        })

        expect(await service.runScheduled(NOW)).toEqual({ clubs: 5, history: 3, failed: 1 })
        expect(history.mock.calls.map((c) => c[0])).toEqual(['new', 'stale', 'night'])
    })

    it('refresh builds both parts', async () => {
        const service = new AnalyticsSnapshotService(makePrisma() as never)
        const history = jest.spyOn(service, 'refreshHistory').mockResolvedValue()
        const risk = jest.spyOn(service, 'refreshRisk').mockResolvedValue()
        await service.refresh('ws', NOW)
        expect(history).toHaveBeenCalledWith('ws', NOW)
        expect(risk).toHaveBeenCalledWith('ws', NOW)
    })
})
