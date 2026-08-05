import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { UpdateWorkspaceMemberAccessFeature } from './update-workspace-member-access.feature'
import { UpdateWorkspaceMemberAccessHandler } from './update-workspace-member-access.handler'

const OWNER = 'owner-1'

const build = () => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: OWNER,
                coachSeesAllGroups: false,
            }),
        },
        workspaceMember: {
            update: jest.fn().mockResolvedValue({
                userId: 'member-1',
                accessUntil: new Date('2026-09-04T00:00:00.000Z'),
            }),
        },
    }
    // The real RbacService, driven by the same prisma double, so the test
    // exercises the actual owner/role/super-admin decision rather than a stub.
    const { RbacService } = jest.requireActual<
        typeof import('../../shared/services/rbac.service')
    >('../../shared/services/rbac.service')
    const rbac = new RbacService(prisma as never)
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }

    const handler = new UpdateWorkspaceMemberAccessHandler(
        prisma as never,
        audit as never,
        realtime as never,
        rbac as never,
    )
    return { handler, prisma, audit, realtime }
}

const run = (
    handler: UpdateWorkspaceMemberAccessHandler,
    opts: {
        invoker?: string
        roleName?: string | null
        isSuperAdmin?: boolean
        targetUserId?: string
    } = {},
) =>
    handler.execute(
        new UpdateWorkspaceMemberAccessFeature(
            { accessUntil: '2026-09-04' } as never,
            'ws-1',
            opts.targetUserId ?? 'member-1',
            opts.invoker ?? OWNER,
            opts.roleName ?? null,
            opts.isSuperAdmin ?? false,
        ),
    )

describe('UpdateWorkspaceMemberAccessHandler', () => {
    it('lets the workspace owner set an access window', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.workspaceMember.update).toHaveBeenCalled()
    })

    // These two are the reported bug: the route declares WORKSPACE_ADMINS, but
    // the handler compared ownerId and 403'd everyone else — the UI showed the
    // date picker and «Сохранить» blew up.
    it('lets a workspace admin who is not the owner set it', async () => {
        const { handler, prisma } = build()
        await run(handler, { invoker: 'admin-1', roleName: 'admin' })
        expect(prisma.workspaceMember.update).toHaveBeenCalled()
    })

    it('lets a head_coach set it', async () => {
        const { handler, prisma } = build()
        await run(handler, { invoker: 'hc-1', roleName: 'head_coach' })
        expect(prisma.workspaceMember.update).toHaveBeenCalled()
    })

    it('lets the platform super admin set it with no membership at all', async () => {
        const { handler, prisma } = build()
        await run(handler, {
            invoker: 'platform-admin',
            roleName: null,
            isSuperAdmin: true,
        })
        expect(prisma.workspaceMember.update).toHaveBeenCalled()
    })

    it('still refuses a plain coach', async () => {
        const { handler, prisma } = build()
        await expect(
            run(handler, { invoker: 'coach-1', roleName: 'coach' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
    })

    it('still refuses an ordinary member', async () => {
        const { handler, prisma } = build()
        await expect(
            run(handler, { invoker: 'user-1', roleName: 'user' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
    })

    // The owner's access is unbounded by definition; writing a window for them
    // would be a way to lock the owner out of their own club.
    it('refuses to set a window on the owner', async () => {
        const { handler } = build()
        await expect(
            run(handler, { targetUserId: OWNER }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('records an audit entry and refreshes the roster', async () => {
        const { handler, audit, realtime } = build()
        await run(handler)
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'member.updateAccess' }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('ws-1', [
            'members',
            'subscription',
        ])
    })
})
