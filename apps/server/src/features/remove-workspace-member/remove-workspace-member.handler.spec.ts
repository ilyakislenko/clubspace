import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RemoveWorkspaceMemberFeature } from './remove-workspace-member.feature'
import { RemoveWorkspaceMemberHandler } from './remove-workspace-member.handler'

const build = (o: { admin?: boolean; member?: boolean } = {}) => {
    const prisma: any = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(o.member === false ? null : { id: 'm1' }),
            delete: jest.fn().mockResolvedValue({}),
        },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
        rankGradingCandidate: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        groupMember: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        groupCoach: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        personalTrainingCoach: {
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        attendanceSession: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        personalTrainingRequest: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    }
    prisma.$transaction = jest.fn(async (fn: (t: unknown) => unknown) =>
        fn(prisma),
    )
    const audit = { record: jest.fn() }
    const realtime = { invalidate: jest.fn() }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({}),
        canWriteAllGroups: jest.fn().mockReturnValue(o.admin !== false),
    }
    const handler = new RemoveWorkspaceMemberHandler(
        prisma as never,
        audit as never,
        realtime as never,
        rbac as never,
    )
    return { handler, prisma }
}

const run = (handler: RemoveWorkspaceMemberHandler) =>
    handler.execute(
        new RemoveWorkspaceMemberFeature('w1', 'u1', 'admin1', 'admin', false),
    )

describe('RemoveWorkspaceMemberHandler', () => {
    it('removes the member and their guest bookings in this club', async () => {
        const { handler, prisma } = build()
        await expect(run(handler)).resolves.toEqual({ status: 'removed' })
        expect(prisma.workspaceMember.delete).toHaveBeenCalledWith({
            where: { id: 'm1' },
        })
        expect(prisma.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
        })
    })

    it('drops only the open grading slots of this club, keeping results', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.rankGradingCandidate.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1', result: 'PENDING' },
        })
    })

    it('also drops the member from this club\'s groups and assistant-coach rows', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.groupMember.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', group: { workspaceId: 'w1' } },
        })
        expect(prisma.groupCoach.deleteMany).toHaveBeenCalledWith({
            where: {
                userId: 'u1',
                role: 'assistant',
                group: { workspaceId: 'w1' },
            },
        })
    })

    it('purges their personal training in this club only', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.personalTrainingCoach.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
        })
        expect(prisma.attendanceSession.deleteMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                workspaceId: 'w1',
                isPersonal: true,
                records: { none: {} },
            }),
        })
        const updates = prisma.personalTrainingRequest.updateMany.mock.calls.map(
            (c: any[]) => c[0],
        )
        expect(updates).toHaveLength(3)
        for (const u of updates) expect(u.where.workspaceId).toBe('w1')
        expect(updates[0].data).toEqual({
            status: 'CANCELLED',
            closedByRole: 'member',
        })
        expect(updates[1].data).toEqual({
            status: 'CANCELLED',
            closedByRole: 'coach',
        })
        expect(updates[2].data).toEqual({
            memberComment: null,
            coachComment: null,
            closeComment: null,
        })
    })

    it('refuses a non-admin and deletes nothing', async () => {
        const { handler, prisma } = build({ admin: false })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
        expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled()
        expect(prisma.personalTrainingCoach.deleteMany).not.toHaveBeenCalled()
    })

    it('404s when the user is not a member', async () => {
        const { handler, prisma } = build({ member: false })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
        expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled()
    })
})
