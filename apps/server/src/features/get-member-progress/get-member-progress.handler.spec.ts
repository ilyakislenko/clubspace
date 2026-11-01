import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
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
            user: {
                id: 'member',
                email: 'm@x',
                firstname: 'M',
                lastname: null,
                dependentOf: [],
            },
            role: { name: 'user' },
            subscriptions: [],
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
    rankPromotion: { findMany: jest.fn().mockResolvedValue([]) },
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

describe('getMemberProgress — access and abonements', () => {
    const run = (prisma: ReturnType<typeof makePrisma>, r: unknown = rbac) =>
        new GetMemberProgressHandler(prisma as any, r as any).execute(
            new GetMemberProgressFeature('w1', 'member', 'coach1', 'coach', false),
        )

    it('refuses a coach looking at a student outside their groups', async () => {
        const prisma = makePrisma()
        prisma.groupMember.findFirst.mockResolvedValue(null)
        const coach = {
            resolveCoachScope: jest.fn().mockResolvedValue({
                scope: 'coach_own_only',
                workspaceOwnerId: 'owner',
            }),
        }
        await expect(run(prisma, coach)).rejects.toThrow(ForbiddenError)
        expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled()
    })

    it('404s an unknown member', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findFirst.mockResolvedValue(null)
        await expect(run(prisma)).rejects.toThrow(NotFoundError)
    })

    it('reads only current abonements, ending soonest first', async () => {
        const prisma = makePrisma()
        const out = await run(prisma)
        const { subscriptions } =
            prisma.workspaceMember.findFirst.mock.calls[0][0].include
        expect(subscriptions.where).toEqual({
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        })
        expect(subscriptions.orderBy).toEqual([
            { endDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
        ])
        expect(out.currentAbonements).toEqual([])
    })

    it('lists every current abonement with its scope', async () => {
        const prisma = makePrisma()
        const base = await prisma.workspaceMember.findFirst()
        const bjj = { id: 'd1', name: 'БЖЖ', color: '#f00', icon: null }
        prisma.workspaceMember.findFirst.mockResolvedValue({
            ...base,
            subscriptions: [
                {
                    id: 's1',
                    status: 'ACTIVE',
                    endDate: new Date('2026-08-01T00:00:00Z'),
                    plan: { name: 'БЖЖ 12' },
                    directions: [{ direction: bjj }],
                },
                {
                    id: 's2',
                    status: 'ACTIVE',
                    endDate: null,
                    plan: { name: 'Клуб' },
                    directions: [],
                },
            ],
        })
        const out = await run(prisma)
        expect(out.currentAbonements).toEqual([
            {
                id: 's1',
                planName: 'БЖЖ 12',
                status: 'ACTIVE',
                endDate: '2026-08-01T00:00:00.000Z',
                directions: [bjj],
            },
            { id: 's2', planName: 'Клуб', status: 'ACTIVE', endDate: null, directions: [] },
        ])
    })
})
