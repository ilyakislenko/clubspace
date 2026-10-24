import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetMyWorkspaceMembershipFeature } from './get-my-workspace-membership.feature'
import { GetMyWorkspaceMembershipHandler } from './get-my-workspace-membership.handler'

const MEMBER_ROW = {
    status: 'ACTIVE',
    accessUntil: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    workspace: { name: 'BJJ School', ownerId: 'owner-1' },
    role: { name: 'coach' },
}

const WORKSPACE_ROW = {
    name: 'BJJ School',
    ownerId: 'owner-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

type BuildOpts = {
    member?: typeof MEMBER_ROW | null
    workspace?: typeof WORKSPACE_ROW | null
}

const build = (opts: BuildOpts = {}) => {
    const prisma = {
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.member === undefined ? MEMBER_ROW : opts.member,
                ),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.workspace === undefined ? WORKSPACE_ROW : opts.workspace,
                ),
        },
    }
    return {
        handler: new GetMyWorkspaceMembershipHandler(prisma as never),
        prisma,
    }
}

const run = (
    handler: GetMyWorkspaceMembershipHandler,
    userId: string,
    isSuperAdmin = false,
) =>
    handler.execute(
        new GetMyWorkspaceMembershipFeature('ws-1', userId, isSuperAdmin),
    )

describe('GetMyWorkspaceMembershipHandler', () => {
    it('reports admin for a super admin whose own row is below admin', async () => {
        const { handler } = build()
        const result = await run(handler, 'u1', true)
        expect(result.role).toBe('admin')
    })

    it('returns the real membership when one exists', async () => {
        const { handler } = build()
        const result = await run(handler, 'u1')
        expect(result.role).toBe('coach')
        expect(result.isOwner).toBe(false)
    })

    it('flags the owner when their membership row exists', async () => {
        const { handler } = build()
        const result = await run(handler, 'owner-1')
        expect(result.isOwner).toBe(true)
    })

    // Both of the following used to 404, which made clients render a
    // read-only screen for people the server lets write.
    it('synthesises admin access for an owner with no membership row', async () => {
        const { handler } = build({ member: null })
        const result = await run(handler, 'owner-1')
        expect(result).toEqual({
            workspaceId: 'ws-1',
            workspaceName: 'BJJ School',
            role: 'admin',
            status: 'ACTIVE',
            accessUntil: null,
            isOwner: true,
            createdAt: '2026-01-01T00:00:00.000Z',
        })
    })

    it('synthesises admin access for a platform super admin', async () => {
        const { handler } = build({ member: null })
        const result = await run(handler, 'platform-admin', true)
        expect(result.role).toBe('admin')
        // Not the owner — the flag must stay honest, it drives "передать
        // клуб"-style UI elsewhere.
        expect(result.isOwner).toBe(false)
    })

    it('still 404s for an unrelated user with no membership', async () => {
        const { handler } = build({ member: null })
        await expect(run(handler, 'stranger')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('404s when the workspace itself is gone', async () => {
        const { handler } = build({ member: null, workspace: null })
        await expect(
            run(handler, 'platform-admin', true),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
