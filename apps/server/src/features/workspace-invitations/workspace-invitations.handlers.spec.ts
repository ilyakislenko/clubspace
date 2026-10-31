import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AcceptWorkspaceInvitationFeature } from './accept-workspace-invitation.feature'
import { AcceptWorkspaceInvitationHandler } from './accept-workspace-invitation.handler'
import { DeclineWorkspaceInvitationFeature } from './decline-workspace-invitation.feature'
import { DeclineWorkspaceInvitationHandler } from './decline-workspace-invitation.handler'
import { ListMyInvitationsFeature } from './list-my-invitations.feature'
import { ListMyInvitationsHandler } from './list-my-invitations.handler'
import { ListWorkspaceInvitationsFeature } from './list-workspace-invitations.feature'
import { ListWorkspaceInvitationsHandler } from './list-workspace-invitations.handler'
import { RevokeWorkspaceInvitationFeature } from './revoke-workspace-invitation.feature'
import { RevokeWorkspaceInvitationHandler } from './revoke-workspace-invitation.handler'

const INV_ID = '11111111-1111-4111-8111-111111111111'
const CREATED = new Date('2026-11-01T10:00:00.000Z')

const rbac = (denied: boolean) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({ scope: denied ? 'coach' : 'admin' }),
    canWriteAllGroups: jest.fn().mockReturnValue(!denied),
})
const auditMock = () => ({ record: jest.fn().mockResolvedValue(undefined) })

describe('listMyInvitations', () => {
    const build = (rows: unknown[], groups: unknown[] = []) => {
        const prisma = {
            workspaceInvitation: { findMany: jest.fn().mockResolvedValue(rows) },
            group: { findMany: jest.fn().mockResolvedValue(groups) },
        }
        return { handler: new ListMyInvitationsHandler(prisma as never), prisma }
    }

    it("reads only the caller's offers from active clubs", async () => {
        const { handler, prisma } = build([])
        await expect(
            handler.execute(new ListMyInvitationsFeature('u1')),
        ).resolves.toEqual({ data: [] })
        expect(prisma.workspaceInvitation.findMany.mock.calls[0][0].where).toEqual({
            userId: 'u1',
            workspace: { isActive: true },
        })
        expect(prisma.group.findMany).not.toHaveBeenCalled()
    })

    it('names the group only when it belongs to the inviting club', async () => {
        const row = (id: string, workspaceId: string, groupId: string | null) => ({
            id,
            roleName: id === 'i2' ? 'coach' : 'user',
            groupId,
            createdAt: CREATED,
            workspace: { id: workspaceId, name: `Club ${workspaceId}`, type: 'YOGA' },
        })
        const { handler } = build(
            [row('i1', 'w1', 'g1'), row('i2', 'w2', 'g1'), row('i3', 'w3', null)],
            [{ id: 'g1', name: 'Утро', workspaceId: 'w1' }],
        )
        const out = await handler.execute(new ListMyInvitationsFeature('u1'))
        expect(out.data).toEqual([
            {
                id: 'i1',
                workspaceId: 'w1',
                workspaceName: 'Club w1',
                workspaceType: 'YOGA',
                roleName: 'user',
                groupName: 'Утро',
                invitedAt: CREATED.toISOString(),
            },
            expect.objectContaining({ id: 'i2', roleName: 'coach', groupName: null }),
            expect.objectContaining({ id: 'i3', groupName: null }),
        ])
    })
})

describe('acceptWorkspaceInvitation', () => {
    it('accepts through the service and audits', async () => {
        const accepted = {
            workspaceId: 'w1',
            workspaceName: 'Club',
            roleName: 'user' as const,
            groupId: 'g1',
        }
        const invitations = { accept: jest.fn().mockResolvedValue(accepted) }
        const audit = auditMock()
        const handler = new AcceptWorkspaceInvitationHandler(
            invitations as never,
            audit as never,
        )
        await expect(
            handler.execute(new AcceptWorkspaceInvitationFeature(INV_ID, 'u1')),
        ).resolves.toEqual(accepted)
        expect(invitations.accept).toHaveBeenCalledWith({
            userId: 'u1',
            invitationId: INV_ID,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.acceptInvitation',
                workspaceId: 'w1',
                actorId: 'u1',
            }),
        )
    })

    it("passes the service's 404 through without auditing", async () => {
        const invitations = {
            accept: jest
                .fn()
                .mockRejectedValue(new NotFoundError({ message: 'Приглашение не найдено' })),
        }
        const audit = auditMock()
        const handler = new AcceptWorkspaceInvitationHandler(
            invitations as never,
            audit as never,
        )
        await expect(
            handler.execute(new AcceptWorkspaceInvitationFeature(INV_ID, 'u2')),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(audit.record).not.toHaveBeenCalled()
    })
})

describe('declineWorkspaceInvitation', () => {
    const build = (removed: unknown) => {
        const invitations = { remove: jest.fn().mockResolvedValue(removed) }
        const audit = auditMock()
        return {
            handler: new DeclineWorkspaceInvitationHandler(
                invitations as never,
                audit as never,
            ),
            invitations,
            audit,
        }
    }

    it("removes only the caller's own offer", async () => {
        const { handler, invitations, audit } = build({ workspaceId: 'w1', userId: 'u1' })
        await expect(
            handler.execute(new DeclineWorkspaceInvitationFeature(INV_ID, 'u1')),
        ).resolves.toEqual({ status: 'declined' })
        expect(invitations.remove).toHaveBeenCalledWith({ id: INV_ID, userId: 'u1' })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'member.declineInvitation', workspaceId: 'w1' }),
        )
    })

    it('404s on an offer that is not theirs (or gone)', async () => {
        const { handler, audit } = build(null)
        await expect(
            handler.execute(new DeclineWorkspaceInvitationFeature(INV_ID, 'u2')),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(audit.record).not.toHaveBeenCalled()
    })
})

describe('listWorkspaceInvitations', () => {
    const build = (denied = false) => {
        const prisma = {
            workspaceInvitation: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 'i1',
                        roleName: 'coach',
                        groupId: null,
                        createdAt: CREATED,
                        user: { email: 'a@b.c' },
                    },
                ]),
            },
        }
        return {
            handler: new ListWorkspaceInvitationsHandler(prisma as never, rbac(denied) as never),
            prisma,
        }
    }
    const run = (h: ListWorkspaceInvitationsHandler, role = 'admin') =>
        h.execute(new ListWorkspaceInvitationsFeature('w1', 'admin1', role, false))

    it('refuses a non-admin', async () => {
        const { handler, prisma } = build(true)
        await expect(run(handler, 'coach')).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceInvitation.findMany).not.toHaveBeenCalled()
    })

    it("lists the club's offers by e-mail only", async () => {
        const { handler, prisma } = build()
        await expect(run(handler)).resolves.toEqual({
            data: [
                {
                    id: 'i1',
                    email: 'a@b.c',
                    roleName: 'coach',
                    groupId: null,
                    invitedAt: CREATED.toISOString(),
                },
            ],
        })
        expect(prisma.workspaceInvitation.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
        })
    })
})

describe('revokeWorkspaceInvitation', () => {
    const build = (o: { denied?: boolean; removed?: unknown } = {}) => {
        const invitations = {
            remove: jest
                .fn()
                .mockResolvedValue('removed' in o ? o.removed : { workspaceId: 'w1', userId: 'u9' }),
        }
        const audit = auditMock()
        return {
            handler: new RevokeWorkspaceInvitationHandler(
                invitations as never,
                rbac(o.denied ?? false) as never,
                audit as never,
            ),
            invitations,
            audit,
        }
    }
    const run = (h: RevokeWorkspaceInvitationHandler) =>
        h.execute(new RevokeWorkspaceInvitationFeature(INV_ID, 'w1', 'admin1', 'admin', false))

    it('refuses a non-admin', async () => {
        const { handler, invitations } = build({ denied: true })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(invitations.remove).not.toHaveBeenCalled()
    })

    it("404s on another club's (or a gone) offer", async () => {
        const { handler } = build({ removed: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('removes the offer scoped to the club and audits', async () => {
        const { handler, invitations, audit } = build()
        await expect(run(handler)).resolves.toEqual({ status: 'revoked' })
        expect(invitations.remove).toHaveBeenCalledWith({ id: INV_ID, workspaceId: 'w1' })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.revokeInvitation',
                targetId: 'u9',
                workspaceId: 'w1',
            }),
        )
    })
})
