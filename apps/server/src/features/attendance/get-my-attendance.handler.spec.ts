import { GetMyAttendanceFeature } from './get-my-attendance.feature'
import { GetMyAttendanceHandler } from './get-my-attendance.handler'

const dbSession = () => ({
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'g1',
    slotId: 's1',
    workspaceEventId: null,
    sessionDate: new Date('2026-07-02T00:00:00Z'),
    title: 'Morning',
    startAt: new Date('2026-07-02T16:00:00Z'),
    timezone: 'Europe/Moscow',
    coachId: 'c1',
    notes: null,
    createdAt: new Date('2026-07-02T16:00:00Z'),
    updatedAt: new Date('2026-07-02T16:00:00Z'),
    _count: { records: 5 },
})

const makePrisma = () => ({
    attendanceRecord: {
        findMany: jest
            .fn()
            .mockResolvedValue([{ session: dbSession() }]),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(12),
    },
})

const run = (prisma: any, payload: any = {}) =>
    new GetMyAttendanceHandler(prisma).execute(
        new GetMyAttendanceFeature(payload, 'w1', 'me'),
    )

describe('getMyAttendance', () => {
    it('queries by workspace + user and returns sessions + counts', async () => {
        const prisma = makePrisma()
        const out = await run(prisma)
        const where = prisma.attendanceRecord.findMany.mock.calls[0][0].where
        expect(where.workspaceId).toBe('w1')
        expect(where.userId).toBe('me')
        expect(out.rangeCount).toBe(1)
        expect(out.total).toBe(12)
        expect(out.sessions[0]).toMatchObject({ id: 'sess1', attendeeCount: 5 })
    })

    it('windows by when the class started, not when it was marked', async () => {
        const prisma = makePrisma()
        await run(prisma, { from: '2026-10-01', to: '2026-10-31' })
        const args = prisma.attendanceRecord.findMany.mock.calls[0][0]
        expect(args.where.markedAt).toBeUndefined()
        expect(args.where.session.startAt).toEqual({
            gte: new Date('2026-10-01T00:00:00Z'),
            lte: new Date('2026-10-31T23:59:59.999Z'),
        })
        expect(args.orderBy).toEqual({ session: { startAt: 'desc' } })
        expect(prisma.attendanceRecord.count.mock.calls[0][0].where).toBe(
            args.where,
        )
    })

    it('rejects an oversized range', async () => {
        await expect(
            run(makePrisma(), { from: '2026-01-01', to: '2026-12-31' }),
        ).rejects.toThrow(/90 days/i)
    })
})
