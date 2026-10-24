import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RejectPendingMemberFeature } from './reject-pending-member.feature'
import { RejectPendingMemberHandler } from './reject-pending-member.handler'

const make = (opts: { count?: number; isAdmin?: boolean } = {}) => {
    const prisma = {
        workspaceMember: {
            updateMany: jest.fn().mockResolvedValue({ count: opts.count ?? 1 }),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(opts.isAdmin ?? true),
    }
    const handler = new RejectPendingMemberHandler(
        prisma as never,
        audit as never,
        realtime as never,
        rbac as never,
    )
    const run = () =>
        handler.execute(
            new RejectPendingMemberFeature('w1', 'u2', 'owner1', 'admin', false),
        )
    return { prisma, audit, realtime, run }
}

describe('RejectPendingMemberHandler', () => {
    it('blocks only INVITED rows, audits and invalidates members', async () => {
        const { prisma, audit, realtime, run } = make()
        await expect(run()).resolves.toEqual({ status: 'rejected' })
        expect(prisma.workspaceMember.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u2', status: 'INVITED' },
            data: { status: 'BLOCKED' },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.rejectPending',
                targetId: 'u2',
                workspaceId: 'w1',
                actorId: 'owner1',
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
    })

    it('404s when no pending row matched (already handled or not INVITED)', async () => {
        const { audit, realtime, run } = make({ count: 0 })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('refuses callers without workspace-admin scope', async () => {
        const { prisma, run } = make({ isAdmin: false })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.updateMany).not.toHaveBeenCalled()
    })
})
