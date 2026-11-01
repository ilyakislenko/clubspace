import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { LeaveWorkspaceFeature } from './leave-workspace.feature'
import { LeaveWorkspaceHandler } from './leave-workspace.handler'

const build = (
    o: { ws?: unknown; member?: unknown; coachedGroups?: number } = {},
) => {
    const tx = {
        workspaceMember: { delete: jest.fn().mockResolvedValue({}) },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({}) },
        classBooking: { updateMany: jest.fn().mockResolvedValue({}) },
        groupMember: { deleteMany: jest.fn().mockResolvedValue({}) },
        groupCoach: { deleteMany: jest.fn().mockResolvedValue({}) },
        directionManager: { deleteMany: jest.fn().mockResolvedValue({}) },
        rankGradingCandidate: { deleteMany: jest.fn().mockResolvedValue({}) },
        subscriptionFreezeRequest: { deleteMany: jest.fn().mockResolvedValue({}) },
        personalTrainingCoach: { deleteMany: jest.fn().mockResolvedValue({}) },
        personalTrainingRequest: { updateMany: jest.fn().mockResolvedValue({}) },
        attendanceSession: { deleteMany: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in o ? o.ws : { ownerId: 'owner' }),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue('member' in o ? o.member : { id: 'm1' }),
        },
        group: { count: jest.fn().mockResolvedValue(o.coachedGroups ?? 0) },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn(), leaveWorkspaceRoom: jest.fn() }
    const handler = new LeaveWorkspaceHandler(
        prisma as never,
        audit as never,
        realtime as never,
    )
    return { handler, prisma, tx, audit, realtime }
}

const run = (h: LeaveWorkspaceHandler, userId = 'u1') =>
    h.execute(new LeaveWorkspaceFeature('w1', userId))

describe('leaveWorkspace', () => {
    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses the owner', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, 'owner')).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s when the caller is not in the club', async () => {
        const { handler, prisma } = build({ member: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses the primary coach of a group in this club', async () => {
        const { handler, prisma } = build({ coachedGroups: 1 })
        await expect(run(handler)).rejects.toThrow(/главный тренер группы/)
        expect(prisma.group.count).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', coachId: 'u1' },
        })
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('removes the membership and its club data, then audits', async () => {
        const { handler, tx, audit, realtime } = build()
        await expect(run(handler)).resolves.toEqual({ status: 'left' })
        expect(tx.workspaceMember.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
        expect(tx.groupMember.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', group: { workspaceId: 'w1' } },
        })
        expect(tx.groupCoach.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', role: 'assistant', group: { workspaceId: 'w1' } },
        })
        expect(tx.directionManager.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
        })
        expect(tx.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
        })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.leave',
            targetType: 'member',
            targetId: 'u1',
            workspaceId: 'w1',
            actorId: 'u1',
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'members',
            'freeze-requests',
        ])
        expect(realtime.leaveWorkspaceRoom).toHaveBeenCalledWith(['u1'], 'w1')
    })
})
