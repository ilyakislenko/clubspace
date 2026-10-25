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
    const realtime = { invalidate: jest.fn() }
    const featuresBus = { execute: jest.fn().mockResolvedValue({ success: true }) }
    const service = new JoinRequestService(
        prisma as never,
        notifications as never,
        realtime as never,
        featuresBus as never,
    )
    return { service, prisma, notifications, realtime, featuresBus }
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

    it('creates an INVITED row when approval is required', async () => {
        const { service, prisma, realtime } = build()
        const out = await service.requestMembership({
            userId: 'u1',
            workspace: ws,
            autoApprove: false,
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
            }),
        ).rejects.toThrow('boom')
    })
})

describe('JoinRequestService staff notifications', () => {
    const request = (
        service: JoinRequestService,
        autoApprove = false,
        userId = 'u1',
    ) => service.requestMembership({ userId, workspace: ws, autoApprove })

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
