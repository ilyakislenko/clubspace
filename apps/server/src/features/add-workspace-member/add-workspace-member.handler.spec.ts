import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddWorkspaceMemberFeature } from './add-workspace-member.feature'
import { AddWorkspaceMemberHandler } from './add-workspace-member.handler'

const build = (
    o: { denied?: boolean; member?: unknown; user?: unknown; ws?: unknown } = {},
) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue(
                'ws' in o ? o.ws : { id: 'w1', name: 'Club', ownerId: 'owner' },
            ),
        },
        role: { findUnique: jest.fn().mockResolvedValue({ id: 'r-user' }) },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(o.member ?? null),
            update: jest.fn().mockResolvedValue({ id: 'm1' }),
            create: jest.fn().mockResolvedValue({ id: 'm2' }),
        },
    }
    const users = {
        getUserByEmail: jest.fn().mockResolvedValue(o.user ?? { id: 'u1' }),
        createUser: jest.fn().mockResolvedValue({ id: 'u-new' }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const joinRequests = { notifyApproved: jest.fn().mockResolvedValue(undefined) }
    const handler = new AddWorkspaceMemberHandler(
        prisma as never,
        users as never,
        audit as never,
        realtime as never,
        rbac as never,
        joinRequests as never,
    )
    return { handler, prisma, users, audit, joinRequests }
}

const run = (handler: AddWorkspaceMemberHandler) =>
    handler.execute(
        new AddWorkspaceMemberFeature(
            { email: ' Ann@B.com ' },
            'w1',
            'admin1',
            'admin',
            false,
        ),
    )

describe('addWorkspaceMember', () => {
    it('refuses a caller without workspace-admin scope', async () => {
        const { handler, prisma, joinRequests } = build({ denied: true })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(joinRequests.notifyApproved).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses someone who is already an active member', async () => {
        const { handler, joinRequests } = build({
            member: { id: 'm1', status: 'ACTIVE' },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(joinRequests.notifyApproved).not.toHaveBeenCalled()
    })

    it('approving a pending request activates it and tells the applicant', async () => {
        const { handler, prisma, joinRequests } = build({
            member: { id: 'm1', status: 'INVITED' },
        })
        const out = await run(handler)
        // Only the status flips: the row keeps whatever role it was invited with.
        expect(prisma.workspaceMember.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'm1' },
            data: { status: 'ACTIVE' },
        })
        expect(
            prisma.workspaceMember.update.mock.calls[0][0].data,
        ).not.toHaveProperty('roleId')
        expect(joinRequests.notifyApproved).toHaveBeenCalledWith({
            userId: 'u1',
            workspaceId: 'w1',
            workspaceName: 'Club',
            membershipId: 'm1',
        })
        expect(out).toMatchObject({ id: 'm1', userId: 'u1', email: 'ann@b.com' })
    })

    it('a fresh add creates an ACTIVE member and sends no approval notice', async () => {
        const { handler, prisma, joinRequests } = build()
        const out = await run(handler)
        expect(prisma.workspaceMember.create).toHaveBeenCalledTimes(1)
        expect(prisma.workspaceMember.create.mock.calls[0][0].data.status).toBe(
            'ACTIVE',
        )
        expect(joinRequests.notifyApproved).not.toHaveBeenCalled()
        expect(out).toMatchObject({ id: 'm2', isNew: false })
    })

    it('creates the account for an unknown e-mail', async () => {
        const { handler, users } = build({ user: null })
        users.getUserByEmail.mockResolvedValue(null)
        const out = await run(handler)
        expect(users.createUser).toHaveBeenCalledWith({ email: 'ann@b.com' })
        expect(out).toMatchObject({ userId: 'u-new', isNew: true })
    })
})
