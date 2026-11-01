jest.mock('../../environments/environment', () => ({
    environment: {
        appUrl: 'https://app.club.test',
        playStoreUrl: undefined,
        ruStoreUrl: undefined,
    },
}))
jest.mock('../../domains/workspace/join-code.store', () => ({
    ensureJoinCode: jest.fn().mockResolvedValue('ABCD2345'),
}))

import { environment } from '../../environments/environment'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PlanLimitReachedError,
} from '../../shared/errors/shared.errors'
import { InviteWorkspaceMemberFeature } from './invite-workspace-member.feature'
import { InviteWorkspaceMemberHandler } from './invite-workspace-member.handler'

type Opts = {
    denied?: boolean
    ws?: unknown
    role?: unknown
    group?: unknown
    user?: unknown
    member?: unknown
    createError?: unknown
    sendSuccess?: boolean
    codeError?: boolean
    limitReached?: boolean
}

const build = (o: Opts = {}) => {
    const tx = {
        user: {
            create: jest.fn().mockImplementation(async () => {
                if (o.createError) throw o.createError
                return { id: 'u-new' }
            }),
            update: jest.fn().mockResolvedValue({}),
        },
        workspaceMember: {
            create: jest.fn().mockResolvedValue({ id: 'm-new' }),
            update: jest.fn().mockResolvedValue({ id: 'm1' }),
        },
        groupMember: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({}),
        },
        groupCoach: { upsert: jest.fn().mockResolvedValue({}) },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue(
                'ws' in o ? o.ws : { id: 'w1', name: 'Club <b>', ownerId: 'owner' },
            ),
        },
        role: {
            findUnique: jest
                .fn()
                .mockResolvedValue('role' in o ? o.role : { id: 'r1' }),
        },
        group: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    'group' in o ? o.group : { id: 'g1', coachId: null },
                ),
        },
        user: { findUnique: jest.fn() },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(o.member ?? null),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!o.denied),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = {
        invalidate: jest.fn(),
        joinWorkspaceRoom: jest.fn(),
        leaveWorkspaceRoom: jest.fn(),
    }
    const bus = {
        execute: jest
            .fn()
            .mockResolvedValue({ success: o.sendSuccess ?? true }),
    }
    const joinRequests = { notifyApproved: jest.fn().mockResolvedValue(undefined) }
    const users = {
        getUserByEmail: jest.fn().mockResolvedValue(o.user ?? null),
    }
    const billing = {
        assertWithinLimit: jest.fn(async (_ws: string, limit: string) => {
            if (o.limitReached) {
                throw new PlanLimitReachedError({
                    limit: limit as 'coaches',
                    max: 2,
                    used: 2,
                    planName: 'Free',
                })
            }
        }),
    }
    const handler = new InviteWorkspaceMemberHandler(
        prisma as never,
        rbac as never,
        audit as never,
        realtime as never,
        bus as never,
        joinRequests as never,
        users as never,
        billing as never,
    )
    return {
        handler,
        prisma,
        tx,
        audit,
        realtime,
        bus,
        joinRequests,
        users,
        billing,
    }
}

const run = (
    handler: InviteWorkspaceMemberHandler,
    payload: Record<string, unknown> = {},
) =>
    handler.execute(
        new InviteWorkspaceMemberFeature(
            {
                email: ' Ann@B.com ',
                role: 'user',
                sendEmail: true,
                ...payload,
            } as never,
            'w1',
            'admin1',
            'admin',
            false,
        ),
    )

const GROUP_ID = '11111111-1111-4111-8111-111111111111'

describe('inviteWorkspaceMember', () => {
    it('refuses a caller without workspace-admin scope', async () => {
        const { handler, prisma, bus } = build({ denied: true })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(bus.execute).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s when the role is not seeded', async () => {
        const { handler } = build({ role: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s on a group from another club', async () => {
        const { handler, prisma } = build({ group: null })
        await expect(
            run(handler, { groupId: GROUP_ID }),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.group.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: GROUP_ID, workspaceId: 'w1' },
            }),
        )
    })

    it('adds a brand-new user as an ACTIVE member with the chosen role', async () => {
        const { handler, tx, audit, realtime } = build()
        const result = await run(handler, {
            role: 'coach',
            firstname: 'Ann',
            lastname: 'Lee',
        })

        expect(tx.user.create).toHaveBeenCalledWith({
            data: {
                email: 'ann@b.com',
                status: 'ACTIVE',
                language: 'RU',
                firstname: 'Ann',
                lastname: 'Lee',
            },
            select: { id: true },
        })
        expect(tx.workspaceMember.create).toHaveBeenCalledWith({
            data: {
                status: 'ACTIVE',
                workspaceId: 'w1',
                userId: 'u-new',
                roleId: 'r1',
            },
        })
        expect(result).toMatchObject({
            userId: 'u-new',
            email: 'ann@b.com',
            roleName: 'coach',
            outcome: 'added',
            isNewUser: true,
            emailSent: true,
            groupId: null,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.invite',
                metadata: expect.objectContaining({ outcome: 'added' }),
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
        expect(realtime.joinWorkspaceRoom).toHaveBeenCalledWith([expect.any(String)], 'w1')
    })

    it('approves an INVITED row and resets its role', async () => {
        const { handler, tx } = build({
            user: { id: 'u1', firstname: 'A', lastname: 'B', status: 'ACTIVE' },
            member: { id: 'm1', status: 'INVITED' },
        })
        const result = await run(handler, { role: 'coach' })
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { status: 'ACTIVE', roleId: 'r1' },
        })
        expect(result.outcome).toBe('approved')
        expect(result.isNewUser).toBe(false)
    })

    it.each(['BLOCKED', 'SUSPENDED'])('restores a %s member', async (status) => {
        const { handler } = build({
            user: { id: 'u1', firstname: 'A', lastname: 'B', status: 'ACTIVE' },
            member: { id: 'm1', status },
        })
        expect((await run(handler)).outcome).toBe('restored')
    })

    it('puts a student into the group as a member', async () => {
        const { handler, tx } = build()
        const result = await run(handler, { groupId: GROUP_ID })
        expect(tx.groupMember.upsert).toHaveBeenCalled()
        expect(tx.dropInBooking.deleteMany).toHaveBeenCalled()
        expect(tx.groupCoach.upsert).not.toHaveBeenCalled()
        expect(result.groupId).toBe('g1')
    })

    it('puts a coach into the group as an assistant coach', async () => {
        const { handler, tx } = build()
        await run(handler, { role: 'coach', groupId: GROUP_ID })
        expect(tx.groupMember.deleteMany).toHaveBeenCalled()
        expect(tx.groupCoach.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { groupId: 'g1', userId: 'u-new', role: 'assistant' },
            }),
        )
        expect(tx.groupMember.upsert).not.toHaveBeenCalled()
    })

    it('fills names only where the user has none', async () => {
        const { handler, tx } = build({
            user: { id: 'u1', firstname: 'Kept', lastname: null, status: 'ACTIVE' },
        })
        await run(handler, { firstname: 'New', lastname: 'Lee' })
        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: 'u1' },
            data: { lastname: 'Lee' },
        })
    })

    it('refuses someone already active', async () => {
        const { handler, prisma } = build({
            user: { id: 'u1', firstname: 'A', lastname: 'B', status: 'ACTIVE' },
            member: { id: 'm1', status: 'ACTIVE' },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses the club owner', async () => {
        const { handler } = build({
            user: { id: 'owner', firstname: 'O', lastname: 'W', status: 'ACTIVE' },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
    })

    it.each(['BLOCKED', 'DELETED'])('refuses a %s account', async (status) => {
        const { handler } = build({
            user: { id: 'u1', firstname: 'A', lastname: 'B', status },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('turns a concurrent-create unique violation into a 409', async () => {
        const { handler } = build({ createError: { code: 'P2002' } })
        await expect(run(handler)).rejects.toBeInstanceOf(ConflictError)
    })

    it('sends the invite e-mail with escaped data when asked', async () => {
        const { handler, bus } = build()
        await run(handler)
        const payload = bus.execute.mock.calls[0][0].payload
        expect(payload.userId).toBe('u-new')
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
            const { handler, bus } = build()
            await run(handler)
            expect(
                bus.execute.mock.calls[0][0].payload.message.data.joinLinkHtml,
            ).toBe('')
        } finally {
            env.appUrl = saved
        }
    })

    it('tells a pending applicant they were approved instead of sending the invite e-mail', async () => {
        const { handler, bus, joinRequests } = build({
            user: { id: 'u1', firstname: 'A', lastname: 'B', status: 'ACTIVE' },
            member: { id: 'm1', status: 'INVITED' },
        })
        const result = await run(handler)
        expect(joinRequests.notifyApproved).toHaveBeenCalledWith({
            userId: 'u1',
            workspaceId: 'w1',
            workspaceName: 'Club <b>',
            membershipId: 'm1',
        })
        expect(bus.execute).not.toHaveBeenCalled()
        expect(result.emailSent).toBe(true)
    })

    it('does not notify an approved applicant when sendEmail is false', async () => {
        const { handler, joinRequests } = build({
            user: { id: 'u1', firstname: 'A', lastname: 'B', status: 'ACTIVE' },
            member: { id: 'm1', status: 'INVITED' },
        })
        await run(handler, { sendEmail: false })
        expect(joinRequests.notifyApproved).not.toHaveBeenCalled()
    })

    it('still audits and answers when the join code cannot be made', async () => {
        const store = jest.requireMock('../../domains/workspace/join-code.store')
        store.ensureJoinCode.mockRejectedValueOnce(new Error('db down'))
        const { handler, audit } = build()
        const result = await run(handler)
        expect(result.emailSent).toBe(false)
        expect(audit.record).toHaveBeenCalled()
    })

    it('reports no group when a student is the group\'s own coach', async () => {
        const { handler, tx } = build({
            group: { id: 'g1', coachId: 'u-new' },
        })
        const result = await run(handler, { groupId: GROUP_ID })
        expect(tx.groupMember.upsert).not.toHaveBeenCalled()
        expect(result.groupId).toBeNull()
    })

    it('sends nothing when sendEmail is false', async () => {
        const { handler, bus } = build()
        const result = await run(handler, { sendEmail: false })
        expect(bus.execute).not.toHaveBeenCalled()
        expect(result.emailSent).toBe(false)
    })

    it('reports emailSent=false when delivery fails, keeping the member', async () => {
        const { handler, tx } = build({ sendSuccess: false })
        const result = await run(handler)
        expect(tx.workspaceMember.create).toHaveBeenCalled()
        expect(result.emailSent).toBe(false)
    })

    describe('plan limits', () => {
        it('checks the member limit for a student and the coach limit for a coach', async () => {
            const student = build()
            await run(student.handler)
            expect(student.billing.assertWithinLimit).toHaveBeenCalledWith(
                'w1',
                'members',
            )
            const coach = build()
            await run(coach.handler, { role: 'coach' })
            expect(coach.billing.assertWithinLimit).toHaveBeenCalledWith(
                'w1',
                'coaches',
            )
        })

        it('refuses past the limit before anything is written or sent', async () => {
            const { handler, prisma, bus } = build({ limitReached: true })
            const err = await run(handler, { role: 'coach' }).catch((e) => e)
            expect(err).toBeInstanceOf(PlanLimitReachedError)
            expect(err.metadata.limit).toBe('coaches')
            expect(prisma.$transaction).not.toHaveBeenCalled()
            expect(bus.execute).not.toHaveBeenCalled()
        })
    })
})
