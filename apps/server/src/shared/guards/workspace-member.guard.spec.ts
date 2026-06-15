import { ExecutionContext } from '@nestjs/common'

jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { BadRequestError, ForbiddenError } from '../errors/shared.errors'
import { WorkspaceMemberGuard } from './workspace-member.guard'

type Membership = {
    id: string
    status: string
    accessUntil: Date | null
} | null

const build = (opts: {
    ownerId?: string
    membership?: Membership
}) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'ownerId' in opts ? { ownerId: opts.ownerId } : null,
                ),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'membership' in opts ? opts.membership : null,
                ),
        },
    }
    return new WorkspaceMemberGuard(prisma as never)
}

const ctx = (
    request: Record<string, unknown>,
): ExecutionContext =>
    ({
        switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext

const member = (over: Partial<NonNullable<Membership>> = {}) => ({
    id: 'm1',
    status: 'ACTIVE',
    accessUntil: null,
    ...over,
})

describe('WorkspaceMemberGuard', () => {
    it('forbids an unauthenticated request', async () => {
        const guard = build({})
        await expect(
            guard.canActivate(ctx({ params: { workspaceId: 'ws-1' } })),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('requires a workspaceId', async () => {
        const guard = build({})
        await expect(
            guard.canActivate(ctx({ user: { userId: 'u1' }, params: {} })),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('forbids a non-member', async () => {
        const guard = build({ ownerId: 'owner', membership: null })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, params: { workspaceId: 'ws-1' } }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('admits the owner even if their membership is inactive/expired', async () => {
        const guard = build({
            ownerId: 'u1',
            membership: member({
                status: 'INACTIVE',
                accessUntil: new Date(Date.now() - 1000),
            }),
        })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, params: { workspaceId: 'ws-1' } }),
            ),
        ).resolves.toBe(true)
    })

    it('admits the owner even with no membership row', async () => {
        // The normal workspace-creation flow doesn't create a member row for
        // the owner; the owner bypass must still let them through.
        const guard = build({ ownerId: 'u1', membership: null })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, params: { workspaceId: 'ws-1' } }),
            ),
        ).resolves.toBe(true)
    })

    it('admits an active member with no access limit', async () => {
        const guard = build({ ownerId: 'owner', membership: member() })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, params: { workspaceId: 'ws-1' } }),
            ),
        ).resolves.toBe(true)
    })

    it('forbids a non-active member', async () => {
        const guard = build({
            ownerId: 'owner',
            membership: member({ status: 'INACTIVE' }),
        })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, params: { workspaceId: 'ws-1' } }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('forbids a member whose access window has expired', async () => {
        const guard = build({
            ownerId: 'owner',
            membership: member({ accessUntil: new Date(Date.now() - 1000) }),
        })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, params: { workspaceId: 'ws-1' } }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('resolves workspaceId from the body when not in params', async () => {
        const guard = build({ ownerId: 'owner', membership: member() })
        await expect(
            guard.canActivate(
                ctx({ user: { userId: 'u1' }, body: { workspaceId: 'ws-1' } }),
            ),
        ).resolves.toBe(true)
    })
})
