// environment.ts reads required env vars at import; stub it so loading the
// service under test doesn't need the full CI env.
jest.mock('../../../environments/environment', () => ({
    environment: {
        storeReview: { email: undefined, code: undefined, workspaceKey: undefined },
    },
}))
jest.mock('../../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../audit/services/audit.service', () => ({
    AuditService: class {},
}))
jest.mock('../../realtime/realtime-emitter.service', () => ({
    RealtimeEmitter: class {},
}))

import { environment } from '../../../environments/environment'
import { StoreReviewMembershipService } from './store-review-membership.service'

const DEMO = { id: 'w-demo', ownerId: 'owner', isActive: true }

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

const build = (
    opts: {
        workspace?: unknown
        member?: unknown
        role?: unknown
    } = {},
) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'workspace' in opts ? opts.workspace : DEMO,
                ),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(opts.member ?? null),
            create: jest.fn().mockResolvedValue({ id: 'm-new' }),
            update: jest.fn().mockResolvedValue({}),
        },
        role: {
            findUnique: jest
                .fn()
                .mockResolvedValue('role' in opts ? opts.role : { id: 'r-user' }),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const service = new StoreReviewMembershipService(
        prisma as never,
        audit as never,
        realtime as never,
    )
    return { service, prisma, audit, realtime }
}

describe('StoreReviewMembershipService.ensureDemoMembership', () => {
    beforeEach(() => {
        environment.storeReview.workspaceKey = 'demo-club'
    })
    afterEach(() => {
        environment.storeReview.workspaceKey = undefined
    })

    it('does nothing without STORE_REVIEW_WORKSPACE_KEY', async () => {
        environment.storeReview.workspaceKey = '   '
        const { service, prisma, audit } = build()
        await service.ensureDemoMembership('reviewer')
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('skips a key that matches no club', async () => {
        const { service, prisma, audit } = build({ workspace: null })
        await service.ensureDemoMembership('reviewer')
        expect(prisma.workspace.findUnique.mock.calls[0][0].where).toEqual({
            key: 'demo-club',
        })
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('skips an inactive club', async () => {
        const { service, prisma } = build({
            workspace: { ...DEMO, isActive: false },
        })
        await service.ensureDemoMembership('reviewer')
        expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
    })

    it('never gives the club owner a member row', async () => {
        const { service, prisma } = build()
        await service.ensureDemoMembership('owner')
        expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
    })

    it('creates an ACTIVE student membership and audits it', async () => {
        const { service, prisma, audit, realtime } = build()
        await service.ensureDemoMembership('reviewer')

        expect(prisma.role.findUnique.mock.calls[0][0].where).toEqual({
            name: 'user',
        })
        expect(prisma.workspaceMember.create.mock.calls[0][0].data).toEqual({
            userId: 'reviewer',
            workspaceId: 'w-demo',
            roleId: 'r-user',
            status: 'ACTIVE',
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w-demo', ['members'])
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.grantStoreReviewAccess',
            targetType: 'member',
            targetId: 'm-new',
            workspaceId: 'w-demo',
            actorId: 'reviewer',
            metadata: { change: 'created' },
        })
    })

    it('is idempotent for a membership that already gives access', async () => {
        const { service, prisma, audit, realtime } = build({
            member: {
                id: 'm1',
                status: 'ACTIVE',
                accessUntil: new Date(Date.now() + 86_400_000),
            },
        })
        await service.ensureDemoMembership('reviewer')
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it.each(['INVITED', 'BLOCKED', 'SUSPENDED'])(
        'reactivates a %s membership without touching its role',
        async (status) => {
            const { service, prisma, audit } = build({
                member: { id: 'm1', status, accessUntil: null },
            })
            await service.ensureDemoMembership('reviewer')
            expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
                where: { id: 'm1' },
                data: { status: 'ACTIVE' },
            })
            expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
            expect(audit.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'member.grantStoreReviewAccess',
                    targetId: 'm1',
                    workspaceId: 'w-demo',
                    metadata: {
                        change: 'reactivated',
                        previousStatus: status,
                        accessUntilCleared: false,
                    },
                }),
            )
        },
    )

    it('lifts an expired access window on an ACTIVE membership', async () => {
        const { service, prisma, audit } = build({
            member: {
                id: 'm1',
                status: 'ACTIVE',
                accessUntil: new Date(Date.now() - 86_400_000),
            },
        })
        await service.ensureDemoMembership('reviewer')
        expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { status: 'ACTIVE', accessUntil: null },
        })
        expect(audit.record.mock.calls[0][0].metadata).toEqual({
            change: 'reactivated',
            previousStatus: 'ACTIVE',
            accessUntilCleared: true,
        })
    })

    it('treats a concurrent create as done and audits once', async () => {
        const { service, prisma, audit } = build()
        prisma.workspaceMember.create.mockRejectedValue(p2002())
        await expect(
            service.ensureDemoMembership('reviewer'),
        ).resolves.toBeUndefined()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('skips the club when the student role is missing', async () => {
        const { service, prisma, audit } = build({ role: null })
        await service.ensureDemoMembership('reviewer')
        expect(prisma.workspaceMember.create).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('never fails the sign-in on a database error', async () => {
        const { service, prisma, audit } = build()
        prisma.workspaceMember.create.mockRejectedValue(new Error('db down'))
        await expect(
            service.ensureDemoMembership('reviewer'),
        ).resolves.toBeUndefined()
        expect(audit.record).not.toHaveBeenCalled()
    })
})
