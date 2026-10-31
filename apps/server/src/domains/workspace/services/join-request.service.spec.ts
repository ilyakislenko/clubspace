// environment.ts reads required env vars at import; stub it so loading the
// service under test doesn't need the full CI env.
jest.mock('../../../environments/environment', () => ({
    environment: {
        adminUrl: 'https://admin.club.example',
        appUrl: 'https://app.club.example',
        playStoreUrl: undefined,
        ruStoreUrl: undefined,
    },
}))

import { NotFoundError } from '../../../shared/errors/shared.errors'
import { JoinRequestService } from './join-request.service'

const ws = { id: 'w1', name: 'Club <b>', ownerId: 'owner' }

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

const build = () => {
    const prisma = {
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ id: 'm1' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        notificationDispatchLog: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockResolvedValue({}),
        },
        role: { findUnique: jest.fn().mockResolvedValue({ id: 'r1' }) },
        user: {
            findUnique: jest.fn().mockResolvedValue({
                email: 'a@b.com',
                firstname: 'Ann',
                lastname: 'Lee',
            }),
        },
    }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = {
        invalidate: jest.fn(),
        joinWorkspaceRoom: jest.fn(),
        leaveWorkspaceRoom: jest.fn(),
    }
    const featuresBus = { execute: jest.fn().mockResolvedValue({ success: true }) }
    // Unlimited by default; a test sets `remaining: 0` for a full club.
    const billing = {
        remaining: jest.fn().mockResolvedValue({
            remaining: null,
            planName: 'Club',
            max: null,
            used: 0,
        }),
    }
    const service = new JoinRequestService(
        prisma as never,
        notifications as never,
        realtime as never,
        featuresBus as never,
        billing as never,
    )
    return { service, prisma, notifications, realtime, featuresBus, billing }
}

describe('JoinRequestService.findExisting', () => {
    it('answers owner without touching the database', async () => {
        const { service, prisma } = build()
        await expect(service.findExisting('owner', ws)).resolves.toEqual({
            kind: 'owner',
        })
        expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled()
    })

    it.each(['ACTIVE', 'INVITED', 'BLOCKED', 'SUSPENDED'])(
        'reports an existing %s row',
        async (status) => {
            const { service, prisma } = build()
            prisma.workspaceMember.findUnique.mockResolvedValue({
                id: 'm9',
                status,
            })
            await expect(service.findExisting('u1', ws)).resolves.toEqual({
                kind: 'existing',
                status,
                membershipId: 'm9',
            })
            expect(
                prisma.workspaceMember.findUnique.mock.calls[0][0].where,
            ).toEqual({
                userId_workspaceId: { userId: 'u1', workspaceId: 'w1' },
            })
        },
    )

    it('returns null when there is no row', async () => {
        const { service } = build()
        await expect(service.findExisting('u1', ws)).resolves.toBeNull()
    })
})

describe('JoinRequestService.requestMembership', () => {
    it('never creates a row for the owner', async () => {
        const { service, prisma, notifications } = build()
        const out = await service.requestMembership({
            userId: 'owner',
            workspace: ws,
            autoApprove: true,
            audience: 'staff',
        })
        expect(out).toEqual({ kind: 'owner' })
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('returns an existing row untouched and silent', async () => {
        const { service, prisma, notifications, realtime } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue({
            id: 'm9',
            status: 'BLOCKED',
        })
        const out = await service.requestMembership({
            userId: 'u1',
            workspace: ws,
            autoApprove: true,
            audience: 'staff',
        })
        expect(out).toEqual({
            kind: 'existing',
            status: 'BLOCKED',
            membershipId: 'm9',
        })
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('approves an older waiting request when auto-approving, keeping the role', async () => {
        const { service, prisma, realtime, notifications } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue({
            id: 'm9',
            status: 'INVITED',
        })
        const out = await service.requestMembership({
            userId: 'u1',
            workspace: ws,
            autoApprove: true,
            audience: 'staff',
        })
        expect(out).toEqual({
            kind: 'created',
            status: 'ACTIVE',
            membershipId: 'm9',
        })
        expect(prisma.workspaceMember.updateMany).toHaveBeenCalledWith({
            where: { id: 'm9', status: 'INVITED' },
            data: { status: 'ACTIVE' },
        })
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
        expect(realtime.joinWorkspaceRoom).toHaveBeenCalledWith(['u1'], 'w1')
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('leaves a waiting request alone when approval is still required', async () => {
        const { service, prisma } = build()
        prisma.workspaceMember.findUnique.mockResolvedValue({
            id: 'm9',
            status: 'INVITED',
        })
        await expect(
            service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: false,
                audience: 'staff',
            }),
        ).resolves.toMatchObject({ kind: 'existing', status: 'INVITED' })
        expect(prisma.workspaceMember.updateMany).not.toHaveBeenCalled()
    })

    it('reports the current state when an admin decided first', async () => {
        const { service, prisma } = build()
        prisma.workspaceMember.findUnique
            .mockResolvedValueOnce({ id: 'm9', status: 'INVITED' })
            .mockResolvedValueOnce({ id: 'm9', status: 'BLOCKED' })
        prisma.workspaceMember.updateMany.mockResolvedValue({ count: 0 })
        await expect(
            service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: true,
                audience: 'staff',
            }),
        ).resolves.toMatchObject({ kind: 'existing', status: 'BLOCKED' })
    })

    it('creates an INVITED row when approval is required', async () => {
        const { service, prisma, realtime } = build()
        const out = await service.requestMembership({
            userId: 'u1',
            workspace: ws,
            autoApprove: false,
            audience: 'staff',
        })
        expect(out).toEqual({
            kind: 'created',
            status: 'INVITED',
            membershipId: 'm1',
        })
        expect(prisma.workspaceMember.create.mock.calls[0][0].data).toEqual({
            status: 'INVITED',
            userId: 'u1',
            workspaceId: 'w1',
            roleId: 'r1',
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members'])
    })

    it('creates an ACTIVE row when auto-approving', async () => {
        const { service, prisma } = build()
        const out = await service.requestMembership({
            userId: 'u1',
            workspace: ws,
            autoApprove: true,
            audience: 'staff',
        })
        expect(out).toMatchObject({ kind: 'created', status: 'ACTIVE' })
        expect(prisma.workspaceMember.create.mock.calls[0][0].data.status).toBe(
            'ACTIVE',
        )
    })

    it('404s when the base role is missing', async () => {
        const { service, prisma } = build()
        prisma.role.findUnique.mockResolvedValue(null)
        await expect(
            service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: false,
                audience: 'staff',
            }),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
    })

    it('treats a P2002 race as "already there" and does not notify twice', async () => {
        const { service, prisma, notifications, realtime } = build()
        prisma.workspaceMember.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'm7', status: 'INVITED' })
        prisma.workspaceMember.create.mockRejectedValue(p2002())
        const out = await service.requestMembership({
            userId: 'u1',
            workspace: ws,
            autoApprove: false,
            audience: 'staff',
        })
        expect(out).toEqual({
            kind: 'existing',
            status: 'INVITED',
            membershipId: 'm7',
        })
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('rethrows an error that is not a collision', async () => {
        const { service, prisma } = build()
        prisma.workspaceMember.create.mockRejectedValue(new Error('boom'))
        await expect(
            service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: false,
                audience: 'staff',
            }),
        ).rejects.toThrow('boom')
    })

    describe('plan member limit', () => {
        const full = { remaining: 0, planName: 'Free', max: 30, used: 30 }

        it('files a pending request instead of auto-approving into a full club', async () => {
            const { service, prisma, billing } = build()
            billing.remaining.mockResolvedValue(full)
            const out = await service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: true,
                audience: 'staff',
            })
            expect(billing.remaining).toHaveBeenCalledWith('w1', 'members')
            expect(prisma.workspaceMember.create.mock.calls[0][0].data.status).toBe(
                'INVITED',
            )
            expect(out).toEqual({
                kind: 'created',
                status: 'INVITED',
                membershipId: 'm1',
            })
        })

        it('leaves an older request waiting when the club is full', async () => {
            const { service, prisma, billing } = build()
            billing.remaining.mockResolvedValue(full)
            prisma.workspaceMember.findUnique.mockResolvedValue({
                id: 'm9',
                status: 'INVITED',
            })
            const out = await service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: true,
                audience: 'staff',
            })
            expect(out).toEqual({
                kind: 'existing',
                status: 'INVITED',
                membershipId: 'm9',
            })
            expect(prisma.workspaceMember.updateMany).not.toHaveBeenCalled()
        })

        it('does not consult the plan when the club approves by hand', async () => {
            const { service, billing } = build()
            await service.requestMembership({
                userId: 'u1',
                workspace: ws,
                autoApprove: false,
                audience: 'staff',
            })
            expect(billing.remaining).not.toHaveBeenCalled()
        })
    })
})

describe('JoinRequestService staff notifications', () => {
    const request = (
        service: JoinRequestService,
        autoApprove = false,
        userId = 'u1',
        audience: 'staff' | 'owner' = 'staff',
    ) =>
        service.requestMembership({
            userId,
            workspace: ws,
            autoApprove,
            audience,
        })

    it('notifies admins, head coaches and the owner once each, minus the applicant', async () => {
        const { service, prisma, notifications } = build()
        prisma.workspaceMember.findMany.mockResolvedValue([
            { userId: 'adm' },
            { userId: 'hc' },
            { userId: 'owner' }, // an owner with a row: still one notification
            { userId: 'u1' }, // the applicant is never told about themselves
        ])
        await request(service)

        const where = prisma.workspaceMember.findMany.mock.calls[0][0].where
        expect(where).toEqual({
            workspaceId: 'w1',
            status: 'ACTIVE',
            role: { name: { in: ['admin', 'head_coach'] } },
        })
        const sent = notifications.notifyUser.mock.calls.map((c) => c[0])
        expect(sent.map((n) => n.userId).sort()).toEqual([
            'adm',
            'hc',
            'owner',
        ])
        expect(sent[0]).toMatchObject({
            kind: 'member.join_requested',
            topic: 'Новая заявка в «Club <b>»',
            message: 'Ann Lee (a@b.com) хочет вступить в клуб',
            metadata: {
                workspaceId: 'w1',
                applicantUserId: 'u1',
                membershipId: 'm1',
            },
        })
        expect(new Set(sent.map((n) => n.refId)).size).toBe(3)
        expect(sent[0].refId).toBe(`m1:${sent[0].userId}`)
    })

    it('uses just the e-mail when the applicant has no name', async () => {
        const { service, prisma, notifications } = build()
        prisma.user.findUnique.mockResolvedValue({
            email: 'a@b.com',
            firstname: null,
            lastname: null,
        })
        await request(service)
        expect(notifications.notifyUser.mock.calls[0][0].message).toBe(
            'a@b.com хочет вступить в клуб',
        )
    })

    it('sends the owner e-mail for a pending request, linking to the admin host', async () => {
        const { service, featuresBus } = build()
        await request(service)
        expect(featuresBus.execute).toHaveBeenCalledTimes(1)
        const payload = featuresBus.execute.mock.calls[0][0].payload
        expect(payload).toMatchObject({
            userId: 'owner',
            types: ['EMAIL'],
            forced: true,
            message: {
                htmlTemplateKey: 'pending-member',
                data: {
                    workspaceName: 'Club &lt;b&gt;',
                    userEmail: 'a@b.com',
                    adminUrl: 'https://admin.club.example/workspace/w1/users',
                },
            },
        })
    })

    it('escapes the applicant e-mail in the owner e-mail', async () => {
        const { service, prisma, featuresBus } = build()
        prisma.user.findUnique.mockResolvedValue({
            email: '"x"<i>@b.com',
            firstname: null,
            lastname: null,
        })
        await request(service)
        expect(
            featuresBus.execute.mock.calls[0][0].payload.message.data.userEmail,
        ).toBe('&quot;x&quot;&lt;i&gt;@b.com')
    })

    it('announces an auto-approved joiner as joined, with no owner e-mail', async () => {
        const { service, notifications, featuresBus } = build()
        await request(service, true)
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'member.joined',
            topic: 'Новый участник в «Club <b>»',
            message: 'Ann Lee (a@b.com) — новый участник клуба (вступил по коду)',
        })
        expect(featuresBus.execute).not.toHaveBeenCalled()
    })

    it('tells only the owner on the unauthenticated e-mail path', async () => {
        const { service, prisma, notifications, featuresBus } = build()
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'adm' }])
        await request(service, false, 'u1', 'owner')
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
        expect(
            notifications.notifyUser.mock.calls.map((c) => c[0].userId),
        ).toEqual(['owner'])
        expect(featuresBus.execute).toHaveBeenCalledTimes(1)
    })

    it('one failing recipient does not skip the others or the owner e-mail', async () => {
        const { service, prisma, notifications, featuresBus } = build()
        prisma.workspaceMember.findMany.mockResolvedValue([
            { userId: 'adm' },
            { userId: 'hc' },
        ])
        notifications.notifyUser.mockRejectedValueOnce(new Error('push down'))
        await request(service)
        expect(notifications.notifyUser).toHaveBeenCalledTimes(3)
        expect(featuresBus.execute).toHaveBeenCalledTimes(1)
    })

    it('stops notifying a club after 20 requests in the last hour', async () => {
        const { service, prisma, notifications, featuresBus } = build()
        prisma.notificationDispatchLog.count.mockResolvedValue(20)
        await expect(request(service)).resolves.toMatchObject({
            kind: 'created',
        })
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(featuresBus.execute).not.toHaveBeenCalled()
        const where = prisma.notificationDispatchLog.count.mock.calls[0][0].where
        expect(where).toMatchObject({
            kind: 'join-request-notice',
            refId: { startsWith: 'w1:' },
        })
        expect(where.dispatchedAt.gte).toBeInstanceOf(Date)
    })

    it('logs the request against the cap while under it', async () => {
        const { service, prisma } = build()
        prisma.notificationDispatchLog.count.mockResolvedValue(19)
        await request(service)
        expect(prisma.notificationDispatchLog.create).toHaveBeenCalledWith({
            data: { kind: 'join-request-notice', refId: 'w1:m1' },
        })
    })

    it('still succeeds when notifying fails', async () => {
        const { service, notifications, featuresBus } = build()
        notifications.notifyUser.mockRejectedValue(new Error('push down'))
        featuresBus.execute.mockRejectedValue(new Error('smtp down'))
        await expect(request(service)).resolves.toMatchObject({
            kind: 'created',
        })
    })

    it('still succeeds when the e-mail to the owner fails', async () => {
        const { service, featuresBus } = build()
        featuresBus.execute.mockRejectedValue(new Error('smtp down'))
        await expect(request(service)).resolves.toMatchObject({
            kind: 'created',
        })
    })
})

describe('JoinRequestService.notifyApproved', () => {
    const args = {
        userId: 'u1',
        workspaceId: 'w1',
        workspaceName: 'Club <b>',
        membershipId: 'm1',
    }

    it('writes an inbox entry and sends the e-mail', async () => {
        const { service, notifications, featuresBus } = build()
        await service.notifyApproved(args)
        expect(notifications.notifyUser).toHaveBeenCalledWith({
            userId: 'u1',
            kind: 'member.approved',
            refId: 'm1',
            topic: 'Вас приняли в клуб «Club <b>»',
            message: 'Откройте приложение — клуб уже доступен.',
            metadata: { workspaceId: 'w1' },
        })
        const payload = featuresBus.execute.mock.calls[0][0].payload
        expect(payload).toMatchObject({
            userId: 'u1',
            types: ['EMAIL'],
            forced: true,
            message: {
                htmlTemplateKey: 'member-approved',
                data: {
                    workspaceName: 'Club &lt;b&gt;',
                    appUrl: 'https://app.club.example',
                },
            },
        })
        expect(payload.message.data.appLinksHtml).toContain(
            'https://app.club.example',
        )
    })

    it('sends the e-mail even when the inbox write fails, and never throws', async () => {
        const { service, notifications, featuresBus } = build()
        notifications.notifyUser.mockRejectedValue(new Error('db'))
        await expect(service.notifyApproved(args)).resolves.toBeUndefined()
        expect(featuresBus.execute).toHaveBeenCalledTimes(1)
    })

    it('does not throw when the e-mail fails', async () => {
        const { service, featuresBus } = build()
        featuresBus.execute.mockRejectedValue(new Error('smtp'))
        await expect(service.notifyApproved(args)).resolves.toBeUndefined()
    })
})
