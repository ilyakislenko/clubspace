import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { AllowExpiredAccess } from '../decorators/allow-expired-access.decorator'
import { AllowSuspendedWorkspace } from '../decorators/allow-suspended-workspace.decorator'
import {
    BadRequestError,
    ForbiddenError,
    WorkspaceSuspendedError,
} from '../errors/shared.errors'
import { WorkspaceMemberGuard } from './workspace-member.guard'

type Membership = {
    id: string
    status: string
    accessUntil: Date | null
} | null

const build = (opts: {
    ownerId?: string
    membership?: Membership
    isActive?: boolean
    billingStatus?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED'
}) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'ownerId' in opts
                        ? {
                              ownerId: opts.ownerId,
                              name: 'Club',
                              isActive: opts.isActive ?? true,
                              billing: opts.billingStatus
                                  ? { status: opts.billingStatus }
                                  : null,
                          }
                        : null,
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
    return new WorkspaceMemberGuard(new Reflector(), prisma as never)
}

const ctx = (
    request: Record<string, unknown>,
    handler: object = () => undefined,
): ExecutionContext =>
    ({
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => class {},
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

    // Platform staff administer clubs they never joined — the console lists
    // every workspace and opens any of them. Without this the platform admin
    // passed RoleGuard and got 'admin' scope from RbacService, then hit 403
    // here on every single endpoint.
    it('admits a platform super admin with no membership', async () => {
        const guard = build({ ownerId: 'someone-else', membership: null })
        await expect(
            guard.canActivate(
                ctx({
                    user: { userId: 'u1', isSuperAdmin: true },
                    params: { workspaceId: 'ws-1' },
                }),
            ),
        ).resolves.toBe(true)
    })

    it('admits a platform super admin whose membership is suspended', async () => {
        const guard = build({
            ownerId: 'someone-else',
            membership: member({ status: 'SUSPENDED' }),
        })
        await expect(
            guard.canActivate(
                ctx({
                    user: { userId: 'u1', isSuperAdmin: true },
                    params: { workspaceId: 'ws-1' },
                }),
            ),
        ).resolves.toBe(true)
    })

    // The bypass must not skip the workspaceId requirement — a missing id is a
    // malformed request whoever sends it.
    it('still requires a workspaceId from a super admin', async () => {
        const guard = build({ ownerId: 'owner', membership: member() })
        await expect(
            guard.canActivate(ctx({ user: { userId: 'u1', isSuperAdmin: true } })),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('does not admit a non-member just because isSuperAdmin is false', async () => {
        const guard = build({ ownerId: 'someone-else', membership: null })
        await expect(
            guard.canActivate(
                ctx({
                    user: { userId: 'u1', isSuperAdmin: false },
                    params: { workspaceId: 'ws-1' },
                }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    describe('@AllowExpiredAccess', () => {
        class Dummy {
            @AllowExpiredAccess()
            read() {
                return undefined
            }
        }
        const allowed = Dummy.prototype.read
        const req = {
            user: { userId: 'u1' },
            params: { workspaceId: 'ws-1' },
        }
        const expired = new Date(Date.now() - 1000)

        it('admits a member whose access window has expired', async () => {
            const guard = build({
                ownerId: 'owner',
                membership: member({ accessUntil: expired }),
            })
            await expect(guard.canActivate(ctx(req, allowed))).resolves.toBe(
                true,
            )
        })

        it('still refuses an expired member on an unmarked route', async () => {
            const guard = build({
                ownerId: 'owner',
                membership: member({ accessUntil: expired }),
            })
            await expect(
                guard.canActivate(ctx(req)),
            ).rejects.toBeInstanceOf(ForbiddenError)
        })

        it.each(['SUSPENDED', 'INVITED', 'INACTIVE'])(
            'still refuses a %s member',
            async (status) => {
                const guard = build({
                    ownerId: 'owner',
                    membership: member({ status, accessUntil: expired }),
                })
                await expect(
                    guard.canActivate(ctx(req, allowed)),
                ).rejects.toBeInstanceOf(ForbiddenError)
            },
        )

        it('still refuses a non-member', async () => {
            const guard = build({ ownerId: 'owner', membership: null })
            await expect(
                guard.canActivate(ctx(req, allowed)),
            ).rejects.toBeInstanceOf(ForbiddenError)
        })
    })

    describe('suspended club', () => {
        class Dummy {
            @AllowSuspendedWorkspace()
            billing() {
                return undefined
            }
        }
        const allowed = Dummy.prototype.billing
        const req = {
            user: { userId: 'u1' },
            params: { workspaceId: 'ws-1' },
        }

        it('refuses a member of a billing-suspended club with a typed error', async () => {
            const guard = build({
                ownerId: 'owner',
                membership: member(),
                billingStatus: 'SUSPENDED',
            })
            const err = await guard.canActivate(ctx(req)).catch((e) => e)
            expect(err).toBeInstanceOf(WorkspaceSuspendedError)
            expect(err.code).toBe('WORKSPACE_SUSPENDED')
            expect(err.metadata).toEqual({
                workspaceId: 'ws-1',
                workspaceName: 'Club',
                reason: 'SUSPENDED',
            })
        })

        it('refuses a member of a club the platform switched off', async () => {
            const guard = build({
                ownerId: 'owner',
                membership: member(),
                isActive: false,
            })
            const err = await guard.canActivate(ctx(req)).catch((e) => e)
            expect(err).toBeInstanceOf(WorkspaceSuspendedError)
            expect(err.metadata.reason).toBe('INACTIVE')
        })

        it('refuses the owner too on an unmarked route', async () => {
            const guard = build({ ownerId: 'u1', billingStatus: 'SUSPENDED' })
            await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(
                WorkspaceSuspendedError,
            )
        })

        it('admits the owner and members on an @AllowSuspendedWorkspace route', async () => {
            const owner = build({ ownerId: 'u1', billingStatus: 'SUSPENDED' })
            await expect(owner.canActivate(ctx(req, allowed))).resolves.toBe(true)
            const staff = build({
                ownerId: 'owner',
                membership: member(),
                billingStatus: 'SUSPENDED',
            })
            await expect(staff.canActivate(ctx(req, allowed))).resolves.toBe(true)
        })

        it('tells a stranger only that they are not a member', async () => {
            const guard = build({
                ownerId: 'owner',
                membership: null,
                billingStatus: 'SUSPENDED',
            })
            const err = await guard.canActivate(ctx(req)).catch((e) => e)
            expect(err).toBeInstanceOf(ForbiddenError)
            expect(err).not.toBeInstanceOf(WorkspaceSuspendedError)
        })

        it('lets a past-due club keep working (grace period)', async () => {
            const guard = build({
                ownerId: 'owner',
                membership: member(),
                billingStatus: 'PAST_DUE',
            })
            await expect(guard.canActivate(ctx(req))).resolves.toBe(true)
        })

        it('admits platform staff into a suspended club', async () => {
            const guard = build({ ownerId: 'owner', billingStatus: 'SUSPENDED' })
            await expect(
                guard.canActivate(
                    ctx({ ...req, user: { userId: 'staff', isSuperAdmin: true } }),
                ),
            ).resolves.toBe(true)
        })
    })
})
