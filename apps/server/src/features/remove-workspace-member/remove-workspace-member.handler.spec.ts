import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RemoveWorkspaceMemberFeature } from './remove-workspace-member.feature'
import { RemoveWorkspaceMemberHandler } from './remove-workspace-member.handler'

const build = (o: { admin?: boolean; member?: boolean } = {}) => {
    const prisma = {
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
    }
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

    it('refuses a non-admin and deletes nothing', async () => {
        const { handler, prisma } = build({ admin: false })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
    })

    it('404s when the user is not a member', async () => {
        const { handler, prisma } = build({ member: false })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
    })
})
