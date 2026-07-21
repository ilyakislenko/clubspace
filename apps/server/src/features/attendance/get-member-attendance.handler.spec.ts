import { GetMemberAttendanceFeature } from './get-member-attendance.feature'
import { GetMemberAttendanceHandler } from './get-member-attendance.handler'

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
        findMany: jest.fn().mockResolvedValue([{ session: dbSession() }]),
        count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(12),
    },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (prisma: any, payload: any = {}) =>
    new GetMemberAttendanceHandler(prisma).execute(
        new GetMemberAttendanceFeature(payload, 'w1', 'target-user'),
    )

describe('getMemberAttendance', () => {
    it('queries by workspace + the target member and returns sessions + counts', async () => {
        const prisma = makePrisma()
        const out = await run(prisma)
        const where = prisma.attendanceRecord.findMany.mock.calls[0][0].where
        expect(where.workspaceId).toBe('w1')
        // The target member (route param), not the invoker.
        expect(where.userId).toBe('target-user')
        expect(out.rangeCount).toBe(1)
        expect(out.total).toBe(12)
        expect(out.sessions[0]).toMatchObject({ id: 'sess1', attendeeCount: 5 })
    })

    it('rejects an oversized range', async () => {
        await expect(
            run(makePrisma(), { from: '2026-01-01', to: '2026-12-31' }),
        ).rejects.toThrow(/90 days/i)
    })
})
