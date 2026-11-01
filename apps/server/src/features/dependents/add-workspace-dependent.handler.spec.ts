import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddWorkspaceDependentFeature } from './add-workspace-dependent.feature'
import { AddWorkspaceDependentHandler } from './add-workspace-dependent.handler'

const payload = {
    firstname: 'Миша',
    dateOfBirth: '2018-05-04',
    guardianEmail: 'Mom@X.io',
    relation: 'PARENT' as const,
    sendEmail: true,
}

const build = (
    o: {
        scope?: string
        workspace?: unknown
        role?: unknown
        group?: unknown
        guardian?: unknown
        emailOk?: boolean
    } = {},
) => {
    const tx = {
        user: {
            create: jest
                .fn()
                .mockImplementation(async ({ data }: { data: { email: string | null } }) => ({
                    id: data.email === null ? 'kid' : 'new-guardian',
                })),
        },
        workspaceMember: { create: jest.fn().mockResolvedValue({ id: 'wm1' }) },
        groupMember: { create: jest.fn().mockResolvedValue({}) },
        guardianship: { create: jest.fn().mockResolvedValue({ id: 'link1' }) },
    }
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    o.workspace === undefined
                        ? { id: 'w1', name: 'Клуб' }
                        : o.workspace,
                ),
        },
        role: {
            findUnique: jest
                .fn()
                .mockResolvedValue(o.role === undefined ? { id: 'r-user' } : o.role),
        },
        group: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.group === undefined ? { id: 'g-kids' } : o.group),
        },
        $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    }
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: o.scope ?? 'admin', workspaceOwnerId: 'owner' }),
        canWriteAllGroups: jest.fn(
            (ctx: { scope: string }) => ctx.scope === 'admin',
        ),
    }
    const users = {
        getUserByEmail: jest
            .fn()
            .mockResolvedValue(o.guardian === undefined ? null : o.guardian),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const bus = {
        execute: jest.fn().mockResolvedValue({ success: o.emailOk ?? true }),
    }
    const handler = new AddWorkspaceDependentHandler(
        prisma as never,
        rbac as never,
        users as never,
        audit as never,
        realtime as never,
        notifications as never,
        bus as never,
    )
    return { handler, prisma, tx, users, audit, realtime, notifications, bus }
}

const add = (p: Partial<typeof payload> & { groupId?: string } = {}, role = 'admin') =>
    new AddWorkspaceDependentFeature({ ...payload, ...p }, 'w1', 'adm', role, false)

describe('AddWorkspaceDependentHandler', () => {
    it('refuses a coach (admin-only, like inviting a member)', async () => {
        const { handler, prisma } = build({ scope: 'coach_own_only' })
        await expect(handler.execute(add({}, 'coach'))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('reports an unknown club', async () => {
        const { handler } = build({ workspace: null })
        await expect(handler.execute(add())).rejects.toBeInstanceOf(NotFoundError)
    })

    it("refuses a group from another club", async () => {
        const { handler, prisma } = build({ group: null })
        await expect(
            handler.execute(add({ groupId: '6b1c3f8e-1d55-4c3b-8f50-5d8d7e1c2a10' })),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a blocked guardian account', async () => {
        const { handler } = build({
            guardian: { id: 'mom', status: 'BLOCKED', language: 'RU' },
        })
        await expect(handler.execute(add())).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('creates the guardian account for a new e-mail, the child as an ACTIVE member and a pending link', async () => {
        const { handler, tx, notifications, bus, audit, realtime } = build()
        const res = await handler.execute(
            add({ groupId: '6b1c3f8e-1d55-4c3b-8f50-5d8d7e1c2a10' }),
        )

        const created = tx.user.create.mock.calls.map((c) => c[0].data)
        expect(created[0]).toEqual({
            email: 'mom@x.io',
            status: 'ACTIVE',
            language: 'RU',
        })
        expect(created[1]).toEqual(
            expect.objectContaining({ email: null, firstname: 'Миша' }),
        )
        expect(tx.workspaceMember.create.mock.calls[0][0].data).toEqual({
            status: 'ACTIVE',
            workspaceId: 'w1',
            userId: 'kid',
            roleId: 'r-user',
        })
        expect(tx.groupMember.create.mock.calls[0][0].data).toEqual({
            groupId: '6b1c3f8e-1d55-4c3b-8f50-5d8d7e1c2a10',
            userId: 'kid',
        })
        // Pending: no consent until the guardian confirms it.
        expect(tx.guardianship.create.mock.calls[0][0].data).toEqual({
            guardianId: 'new-guardian',
            dependentId: 'kid',
            relation: 'PARENT',
            invitedByWorkspaceId: 'w1',
            invitedById: 'adm',
        })
        // A brand-new address has no app yet: e-mail only.
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        const mail = bus.execute.mock.calls[0][0].payload
        expect(mail.userId).toBe('new-guardian')
        expect(mail.message.htmlTemplateKey).toBe('guardian-invite')
        expect(mail.message.data.childName).toBe('Миша')
        expect(res).toEqual({
            dependentId: 'kid',
            membershipId: 'wm1',
            guardianUserId: 'new-guardian',
            guardianIsNew: true,
            emailSent: true,
            groupId: '6b1c3f8e-1d55-4c3b-8f50-5d8d7e1c2a10',
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.addDependent',
                targetId: 'kid',
                workspaceId: 'w1',
                actorId: 'adm',
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
    })

    it('invites an existing account in the app as well, without creating a user for it', async () => {
        const { handler, tx, notifications } = build({
            guardian: { id: 'mom', status: 'ACTIVE', language: 'RU' },
        })
        const res = await handler.execute(add({ sendEmail: false }))

        expect(tx.user.create).toHaveBeenCalledTimes(1)
        expect(tx.guardianship.create.mock.calls[0][0].data.guardianId).toBe('mom')
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'mom',
                kind: 'guardian.invite',
                refId: 'link1',
                metadata: { dependentId: 'kid', invitedByWorkspaceId: 'w1' },
            }),
        )
        expect(res.guardianIsNew).toBe(false)
        expect(res.emailSent).toBe(false)
        expect(res.groupId).toBeNull()
    })

    it('reports a failed e-mail without failing the request', async () => {
        const { handler } = build({ emailOk: false })
        const res = await handler.execute(add())
        expect(res.emailSent).toBe(false)
    })
})
