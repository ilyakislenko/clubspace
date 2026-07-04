import { GetMemberProgressFeature } from './get-member-progress.feature'
import { GetMemberProgressHandler } from './get-member-progress.handler'

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
    _count: { records: 4 },
})

const makePrisma = () => ({
    groupMember: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    workspaceMember: {
        findFirst: jest.fn().mockResolvedValue({
            id: 'wm1',
            status: 'ACTIVE',
            roleId: 'r1',
            accessUntil: null,
            createdAt: new Date('2026-06-01T00:00:00Z'),
            user: { id: 'member', email: 'm@x', firstname: 'M', lastname: null },
            role: { name: 'user' },
        }),
    },
    video: { count: jest.fn().mockResolvedValue(10) },
    videoWatched: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
    },
    course: { findMany: jest.fn().mockResolvedValue([]) },
    group: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
        findMany: jest.fn().mockResolvedValue([{ session: dbSession() }]),
        count: jest.fn().mockResolvedValue(23),
    },
})

const rbac = {
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: 'admin',
        userId: 'admin1',
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    }),
}

describe('getMemberProgress — attendance summary', () => {
    it('adds user-scoped attendance count + recent sessions', async () => {
        const prisma = makePrisma()
        const out = await new GetMemberProgressHandler(
            prisma as any,
            rbac as any,
        ).execute(
            new GetMemberProgressFeature('w1', 'member', 'admin1', 'admin', false),
        )
        // user-scoped: attendance queries key on the member's userId only.
        expect(prisma.attendanceRecord.count).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'member' },
        })
        expect(out.attendance.count).toBe(23)
        expect(out.attendance.recent[0]).toMatchObject({
            id: 'sess1',
            attendeeCount: 4,
        })
    })
})
