jest.mock('../../../environments/environment', () => ({
    environment: {
        appUrl: 'https://app.club.test',
        playStoreUrl: undefined,
        ruStoreUrl: undefined,
    },
}))
jest.mock('../join-code.store', () => ({
    ensureJoinCode: jest.fn().mockResolvedValue('ABCD2345'),
}))

import { environment } from '../../../environments/environment'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { placeInGroup, WorkspaceInvitationService } from './workspace-invitation.service'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

const INV = {
    id: 'inv1',
    roleName: 'user',
    groupId: null as string | null,
    workspace: { id: 'w1', name: 'Club', isActive: true, ownerId: 'owner' },
}

const build = (
    o: {
        createError?: unknown
        inv?: unknown
        role?: unknown
        member?: unknown
        group?: unknown
        txError?: unknown
        sendSuccess?: boolean
        notifyError?: boolean
    } = {},
) => {
    const tx = {
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(o.member ?? null),
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
        },
        group: {
            findFirst: jest.fn().mockResolvedValue('group' in o ? o.group : null),
        },
        groupMember: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({}),
        },
        groupCoach: { upsert: jest.fn().mockResolvedValue({}) },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({}) },
        workspaceInvitation: { delete: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
        workspaceInvitation: {
            create: jest.fn().mockImplementation(async () => {
                if (o.createError) throw o.createError
                return { id: 'inv-new' }
            }),
            update: jest.fn().mockResolvedValue({ id: 'inv-old' }),
            findFirst: jest.fn().mockResolvedValue('inv' in o ? o.inv : INV),
            findUnique: jest.fn().mockResolvedValue('inv' in o ? o.inv : INV),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        role: {
            findUnique: jest.fn().mockResolvedValue('role' in o ? o.role : { id: 'r1' }),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }) },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => {
            if (o.txError) throw o.txError
            return fn(tx)
        }),
    }
    const notifications = {
        notifyUser: jest.fn().mockImplementation(async () => {
            if (o.notifyError) throw new Error('down')
            return true
        }),
    }
    const realtime = {
        invalidate: jest.fn(),
        invalidateUsers: jest.fn(),
        joinWorkspaceRoom: jest.fn(),
    }
    const bus = {
        execute: jest.fn().mockResolvedValue({ success: o.sendSuccess ?? true }),
    }
    const service = new WorkspaceInvitationService(
        prisma as never,
        notifications as never,
        realtime as never,
        bus as never,
    )
    return { service, prisma, tx, notifications, realtime, bus }
}

const INVITE = {
    workspace: { id: 'w1', name: 'Club <b>' },
    user: { id: 'u1', email: 'a@b.c' },
    roleName: 'coach' as const,
    groupId: 'g1',
    invitedById: 'admin1',
    sendEmail: true,
}

describe('WorkspaceInvitationService.invite', () => {
    it('creates the offer, pushes an inbox entry and e-mails', async () => {
        const { service, prisma, notifications, realtime, bus } = build()
        await expect(service.invite(INVITE)).resolves.toEqual({
            invitationId: 'inv-new',
            emailSent: true,
        })
        expect(prisma.workspaceInvitation.create).toHaveBeenCalledWith({
            data: {
                roleName: 'coach',
                groupId: 'g1',
                invitedById: 'admin1',
                workspaceId: 'w1',
                userId: 'u1',
            },
            select: { id: true },
        })
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u1',
                kind: 'member.invitation',
                refId: 'inv-new',
                metadata: { workspaceId: 'w1', invitationId: 'inv-new' },
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['u1'], ['invitations'])
        expect(bus.execute.mock.calls[0][0].payload.message.data.roleLabel).toBe('тренера')
    })

    it('refreshes an offer already waiting instead of a second row', async () => {
        const { service, prisma, notifications } = build({ createError: p2002() })
        const out = await service.invite({ ...INVITE, sendEmail: false })
        expect(prisma.workspaceInvitation.update).toHaveBeenCalledWith({
            where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
            data: { roleName: 'coach', groupId: 'g1', invitedById: 'admin1' },
            select: { id: true },
        })
        // Same refId: the producer's claim keeps it to one push.
        expect(notifications.notifyUser.mock.calls[0][0].refId).toBe('inv-old')
        expect(out).toEqual({ invitationId: 'inv-old', emailSent: false })
    })

    it('rethrows anything but a unique violation', async () => {
        const { service } = build({ createError: new Error('db') })
        await expect(service.invite(INVITE)).rejects.toThrow('db')
    })

    it('keeps the offer when notifications fail', async () => {
        const { service } = build({ notifyError: true, sendSuccess: false })
        await expect(service.invite(INVITE)).resolves.toEqual({
            invitationId: 'inv-new',
            emailSent: false,
        })
    })

    it('reports emailSent=false when the e-mail throws', async () => {
        const { service, bus } = build()
        bus.execute.mockRejectedValue(new Error('smtp'))
        await expect(service.invite(INVITE)).resolves.toMatchObject({ emailSent: false })
    })
})

describe('WorkspaceInvitationService.sendInviteEmail', () => {
    const args = {
        userId: 'u1',
        workspace: { id: 'w1', name: 'Club <b>' },
        email: 'a@b.c',
        roleName: 'user' as const,
    }

    it('sends the member-invite template with escaped data and the join link', async () => {
        const { service, bus } = build()
        await expect(service.sendInviteEmail(args)).resolves.toBe(true)
        const payload = bus.execute.mock.calls[0][0].payload
        expect(payload.forced).toBe(true)
        expect(payload.message.htmlTemplateKey).toBe('member-invite')
        expect(payload.message.data).toMatchObject({
            workspaceName: 'Club &lt;b&gt;',
            roleLabel: 'ученика',
            joinCodeDisplay: 'ABCD-2345',
            joinLinkHtml:
                ' или откройте ссылку <a href="https://app.club.test/join/ABCD2345">https://app.club.test/join/ABCD2345</a>',
        })
    })

    it('leaves the link fragment empty when APP_URL is not set', async () => {
        const env = environment as { appUrl: string | null }
        const saved = env.appUrl
        env.appUrl = null
        try {
            const { service, bus } = build()
            await service.sendInviteEmail(args)
            expect(bus.execute.mock.calls[0][0].payload.message.data.joinLinkHtml).toBe('')
        } finally {
            env.appUrl = saved
        }
    })
})

describe('WorkspaceInvitationService.accept', () => {
    const accept = (s: WorkspaceInvitationService) =>
        s.accept({ userId: 'u1', invitationId: 'inv1' })

    it("404s on someone else's or a missing offer", async () => {
        const { service, prisma } = build({ inv: null })
        await expect(accept(service)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.workspaceInvitation.findFirst.mock.calls[0][0].where).toEqual({
            id: 'inv1',
            userId: 'u1',
        })
    })

    it('refuses while the club is switched off', async () => {
        const { service, prisma } = build({
            inv: { ...INV, workspace: { ...INV.workspace, isActive: false } },
        })
        await expect(accept(service)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s when the role is not seeded', async () => {
        const { service } = build({ role: null })
        await expect(accept(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('creates an ACTIVE member with the offered role and consumes the offer', async () => {
        const { service, tx, realtime } = build()
        await expect(accept(service)).resolves.toEqual({
            workspaceId: 'w1',
            workspaceName: 'Club',
            roleName: 'user',
            groupId: null,
        })
        expect(tx.workspaceMember.create).toHaveBeenCalledWith({
            data: { status: 'ACTIVE', workspaceId: 'w1', userId: 'u1', roleId: 'r1' },
        })
        expect(tx.workspaceInvitation.delete).toHaveBeenCalledWith({ where: { id: 'inv1' } })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['u1'], ['invitations'])
        expect(realtime.joinWorkspaceRoom).toHaveBeenCalledWith(['u1'], 'w1')
    })

    it.each(['SUSPENDED', 'BLOCKED', 'INVITED'])('reactivates a %s row', async (status) => {
        const { service, tx } = build({ member: { id: 'm1', status } })
        await accept(service)
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { status: 'ACTIVE', roleId: 'r1' },
        })
        expect(tx.workspaceMember.create).not.toHaveBeenCalled()
    })

    it('leaves an already ACTIVE row alone', async () => {
        const { service, tx } = build({ member: { id: 'm1', status: 'ACTIVE' } })
        await accept(service)
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.workspaceMember.create).not.toHaveBeenCalled()
        expect(tx.workspaceInvitation.delete).toHaveBeenCalled()
    })

    it('creates no member row for the owner', async () => {
        const { service, tx } = build({
            inv: { ...INV, workspace: { ...INV.workspace, ownerId: 'u1' } },
        })
        await accept(service)
        expect(tx.workspaceMember.findUnique).not.toHaveBeenCalled()
    })

    it('places a student into the offered group', async () => {
        const { service, tx } = build({
            inv: { ...INV, groupId: 'g1' },
            group: { id: 'g1', coachId: 'c1' },
        })
        expect((await accept(service)).groupId).toBe('g1')
        expect(tx.group.findFirst).toHaveBeenCalledWith({
            where: { id: 'g1', workspaceId: 'w1' },
            select: { id: true, coachId: true },
        })
        expect(tx.groupMember.upsert).toHaveBeenCalled()
    })

    it('makes an invited coach an assistant of the group', async () => {
        const { service, tx } = build({
            inv: { ...INV, roleName: 'coach', groupId: 'g1' },
            group: { id: 'g1', coachId: 'c1' },
        })
        const out = await accept(service)
        expect(out.roleName).toBe('coach')
        expect(tx.groupCoach.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { groupId: 'g1', userId: 'u1', role: 'assistant' },
            }),
        )
    })

    it('skips a group deleted since the invite', async () => {
        const { service, tx } = build({ inv: { ...INV, groupId: 'g1' }, group: null })
        expect((await accept(service)).groupId).toBeNull()
        expect(tx.groupMember.upsert).not.toHaveBeenCalled()
    })

    it('turns a concurrent create into a 409', async () => {
        const { service } = build({ txError: p2002() })
        await expect(accept(service)).rejects.toBeInstanceOf(ConflictError)
    })

    it('rethrows other transaction errors', async () => {
        const { service } = build({ txError: new Error('db') })
        await expect(accept(service)).rejects.toThrow('db')
    })
})

describe('WorkspaceInvitationService.acceptPendingFor', () => {
    it('is null without an offer', async () => {
        const { service, prisma } = build({ inv: null })
        await expect(service.acceptPendingFor('u1', 'w1')).resolves.toBeNull()
        expect(prisma.workspaceInvitation.findUnique).toHaveBeenCalledWith({
            where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
            select: { id: true },
        })
    })

    it('accepts the waiting offer', async () => {
        const { service, tx } = build()
        await expect(service.acceptPendingFor('u1', 'w1')).resolves.toMatchObject({
            workspaceId: 'w1',
        })
        expect(tx.workspaceInvitation.delete).toHaveBeenCalled()
    })
})

describe('WorkspaceInvitationService.remove', () => {
    it('is null when nothing matches', async () => {
        const { service, prisma } = build({ inv: null })
        await expect(service.remove({ id: 'inv1', userId: 'u1' })).resolves.toBeNull()
        expect(prisma.workspaceInvitation.deleteMany).not.toHaveBeenCalled()
    })

    it('deletes the matched offer and refreshes both sides', async () => {
        const { service, prisma, realtime } = build({
            inv: { id: 'inv1', workspaceId: 'w1', userId: 'u1' },
        })
        await expect(service.remove({ id: 'inv1', workspaceId: 'w1' })).resolves.toEqual({
            workspaceId: 'w1',
            userId: 'u1',
        })
        expect(prisma.workspaceInvitation.findFirst.mock.calls[0][0].where).toEqual({
            id: 'inv1',
            workspaceId: 'w1',
        })
        expect(prisma.workspaceInvitation.deleteMany).toHaveBeenCalledWith({
            where: { id: 'inv1' },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(['u1'], ['invitations'])
    })
})

describe('placeInGroup', () => {
    const tx = () => ({
        groupMember: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({}),
        },
        groupCoach: { upsert: jest.fn().mockResolvedValue({}) },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({}) },
    })

    it("does not add a student who is the group's own coach", async () => {
        const t = tx()
        await expect(
            placeInGroup(t as never, {
                group: { id: 'g1', coachId: 'u1' },
                userId: 'u1',
                roleName: 'user',
            }),
        ).resolves.toBe(false)
        expect(t.groupMember.upsert).not.toHaveBeenCalled()
    })

    it('adds a student and drops their guest bookings in that group', async () => {
        const t = tx()
        await expect(
            placeInGroup(t as never, {
                group: { id: 'g1', coachId: 'c1' },
                userId: 'u1',
                roleName: 'user',
            }),
        ).resolves.toBe(true)
        expect(t.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { groupId: 'g1', userId: 'u1' },
        })
    })
})
