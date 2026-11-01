import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddWorkspaceMemberFeature } from './add-workspace-member.feature'
import { AddWorkspaceMemberHandler } from './add-workspace-member.handler'

const build = (
    o: {
        denied?: boolean
        member?: unknown
        user?: unknown
        ws?: unknown
    } = {},
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
    const realtime = {
        invalidate: jest.fn(),
        joinWorkspaceRoom: jest.fn(),
        leaveWorkspaceRoom: jest.fn(),
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const joinRequests = { notifyApproved: jest.fn().mockResolvedValue(undefined) }
    const invitations = {
        invite: jest.fn().mockResolvedValue({ invitationId: 'inv1', emailSent: true }),
    }
    const handler = new AddWorkspaceMemberHandler(
        prisma as never,
        users as never,
        audit as never,
        realtime as never,
        rbac as never,
        joinRequests as never,
        invitations as never,
    )
    return { handler, prisma, users, audit, joinRequests, realtime, invitations }
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
            member: { id: 'm1', status: 'ACTIVE', role: { name: 'user' } },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(joinRequests.notifyApproved).not.toHaveBeenCalled()
    })

    it('approving a pending request activates it and tells the applicant', async () => {
        const { handler, prisma, joinRequests, realtime } = build({
            member: { id: 'm1', status: 'INVITED', role: { name: 'user' } },
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
        expect(out).toEqual({ userId: 'u1', email: 'ann@b.com', outcome: 'approved' })
        // An open app session starts receiving the club's events at once.
        expect(realtime.joinWorkspaceRoom).toHaveBeenCalledWith(['u1'], 'w1')
    })

    it('an applicant typed in another letter case approves the existing request, no new user', async () => {
        const { handler, prisma, users } = build({
            user: { id: 'u-applicant' },
            member: { id: 'm1', status: 'INVITED', role: { name: 'user' } },
        })
        const out = await handler.execute(
            new AddWorkspaceMemberFeature(
                { email: 'ANN@B.COM' },
                'w1',
                'admin1',
                'admin',
                false,
            ),
        )
        expect(users.getUserByEmail).toHaveBeenCalledWith({ email: 'ann@b.com' })
        expect(users.createUser).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'm1' },
            data: { status: 'ACTIVE' },
        })
        expect(out.userId).toBe('u-applicant')
    })

    it('an existing account gets an invitation, not a membership', async () => {
        const { handler, prisma, joinRequests, invitations, audit } = build()
        const out = await run(handler)
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
        expect(joinRequests.notifyApproved).not.toHaveBeenCalled()
        expect(invitations.invite).toHaveBeenCalledWith({
            workspace: { id: 'w1', name: 'Club', ownerId: 'owner' },
            user: { id: 'u1', email: 'ann@b.com' },
            roleName: 'user',
            groupId: null,
            invitedById: 'admin1',
            sendEmail: true,
        })
        expect(out).toEqual({ userId: 'u1', email: 'ann@b.com', outcome: 'invited' })
        expect(audit.record.mock.calls[0][0].metadata).toEqual({
            email: 'ann@b.com',
            outcome: 'invited',
        })
    })

    it.each(['SUSPENDED', 'BLOCKED'])(
        'a %s row of an existing account is an invitation too',
        async (status) => {
            const { handler, prisma, invitations } = build({
                member: { id: 'm1', status },
            })
            expect((await run(handler)).outcome).toBe('invited')
            expect(invitations.invite).toHaveBeenCalled()
            expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
        },
    )

    it.each(['BLOCKED', 'DELETED'])('refuses a %s account', async (status) => {
        const { handler, invitations } = build({ user: { id: 'u1', status } })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(invitations.invite).not.toHaveBeenCalled()
    })

    it('refuses the owner', async () => {
        const { handler } = build({ user: { id: 'owner' } })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('creates the account for an unknown e-mail as an ACTIVE member', async () => {
        const { handler, users, prisma, invitations } = build()
        users.getUserByEmail.mockResolvedValue(null)
        const out = await run(handler)
        expect(users.createUser).toHaveBeenCalledWith({ email: 'ann@b.com' })
        expect(prisma.workspaceMember.create.mock.calls[0][0].data.status).toBe(
            'ACTIVE',
        )
        expect(invitations.invite).not.toHaveBeenCalled()
        expect(out).toEqual({ userId: 'u-new', email: 'ann@b.com', outcome: 'added' })
    })

    const approveById = (handler: AddWorkspaceMemberHandler) =>
        handler.execute(
            new AddWorkspaceMemberFeature(
                { userId: 'kid' },
                'w1',
                'admin1',
                'admin',
                false,
            ),
        )

    it('approves a pending request by user — a child profile has no e-mail', async () => {
        const { handler, prisma, users, joinRequests } = build({
            member: {
                id: 'm1',
                status: 'INVITED',
                role: { name: 'user' },
                user: { id: 'kid', email: null },
            },
        })
        const out = await approveById(handler)
        expect(users.getUserByEmail).not.toHaveBeenCalled()
        expect(users.createUser).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'm1' },
            data: { status: 'ACTIVE' },
        })
        expect(joinRequests.notifyApproved).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'kid', membershipId: 'm1' }),
        )
        expect(out).toEqual({ userId: 'kid', email: null, outcome: 'approved' })
    })

    it('404s when that user has no pending request here', async () => {
        const { handler, prisma } = build({
            member: {
                id: 'm1',
                status: 'ACTIVE',
                role: { name: 'user' },
                user: { id: 'kid', email: null },
            },
        })
        await expect(approveById(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
    })
})
