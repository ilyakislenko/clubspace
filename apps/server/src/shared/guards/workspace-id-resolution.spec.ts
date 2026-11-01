import { ExecutionContext } from '@nestjs/common'
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'

jest.mock('../../infrastructure/prisma', () => ({
    PrismaService: class {},
    UserStatus: { ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED', DELETED: 'DELETED' },
}))

import { RequestWorkspaceId } from '../decorators/request-workspace-id.decorator'
import { BadRequestError } from '../errors/shared.errors'
import { AuthGuard } from './auth.guard'
import { FeatureEnabledGuard } from './feature-enabled.guard'
import { WorkspaceMemberGuard } from './workspace-member.guard'

// Every layer that reads the club must agree on it: the guards authorize the
// club resolveRequestWorkspaceId returns, and @RequestWorkspaceId hands the
// controller that same club. These cases pin the wiring, not the rule (the
// rule is covered in shared/access/resolve-workspace-id.spec.ts).

const MIXED = {
    headers: { authorization: 'Bearer t' },
    params: {},
    query: { workspaceId: 'victim' },
    body: { workspaceId: 'mine' },
}

const ctx = (request: Record<string, unknown>): ExecutionContext =>
    ({
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => () => undefined,
        getClass: () => class {},
    }) as unknown as ExecutionContext

const buildAuthGuard = (tokenPayload: Record<string, unknown>) => {
    const rolesService = {
        getRole: jest.fn().mockResolvedValue({
            id: 'r-coach',
            name: 'coach',
            superuser: false,
            features: [],
            isWorkspaceOwner: false,
        }),
        getRoleForWorkspaceOwner: jest.fn(),
    }
    const guard = new AuthGuard(
        { verifyToken: jest.fn().mockResolvedValue(tokenPayload) } as never,
        new Reflector(),
        rolesService as never,
        {
            getUserById: jest
                .fn()
                .mockResolvedValue({
                    status: 'ACTIVE',
                    isSuperAdmin: false,
                    sessionVersion: 0,
                }),
        } as never,
    )
    return { guard, rolesService }
}

describe('workspaceId resolution across guards', () => {
    it('AuthGuard refuses a request naming two clubs', async () => {
        const { guard, rolesService } = buildAuthGuard({ sub: 'u1', sv: 0 })
        await expect(guard.canActivate(ctx({ ...MIXED }))).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(rolesService.getRole).not.toHaveBeenCalled()
    })

    it('AuthGuard ignores a workspaceId claim in the token', async () => {
        const { guard, rolesService } = buildAuthGuard({
            sub: 'u1',
            sv: 0,
            workspaceId: 'from-token',
        })
        const req: Record<string, unknown> = {
            headers: { authorization: 'Bearer t' },
            params: { workspaceId: 'from-path' },
        }
        await guard.canActivate(ctx(req))
        expect(rolesService.getRole).toHaveBeenCalledWith({
            userId: 'u1',
            workspaceId: 'from-path',
        })
        expect((req.user as { workspaceId: string }).workspaceId).toBe(
            'from-path',
        )
    })

    it('WorkspaceMemberGuard refuses a request naming two clubs', async () => {
        const prisma = {
            workspace: { findUnique: jest.fn() },
            workspaceMember: { findUnique: jest.fn() },
        }
        const guard = new WorkspaceMemberGuard(new Reflector(), prisma as never)
        await expect(
            guard.canActivate(ctx({ ...MIXED, user: { userId: 'u1' } })),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled()
    })

    it('FeatureEnabledGuard checks the club named in the body', async () => {
        const findUnique = jest.fn().mockResolvedValue({ journalEnabled: true })
        const guard = new FeatureEnabledGuard(
            { getAllAndOverride: () => 'journal' } as unknown as Reflector,
            { workspace: { findUnique } } as never,
        )
        await guard.canActivate(
            ctx({ body: { workspaceId: 'w-body' }, user: { userId: 'u1' } }),
        )
        expect(findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'w-body' } }),
        )
    })

    it('FeatureEnabledGuard refuses a request naming two clubs', async () => {
        const guard = new FeatureEnabledGuard(
            { getAllAndOverride: () => 'journal' } as unknown as Reflector,
            { workspace: { findUnique: jest.fn() } } as never,
        )
        await expect(
            guard.canActivate(ctx({ ...MIXED, user: { userId: 'u1' } })),
        ).rejects.toBeInstanceOf(BadRequestError)
    })
})

describe('@RequestWorkspaceId', () => {
    // The factory Nest calls for the parameter, pulled out of the route
    // metadata the decorator writes.
    const factory = (() => {
        class Probe {
            handler(@RequestWorkspaceId() _workspaceId: string) {
                return _workspaceId
            }
        }
        const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler')
        return (
            Object.values(args)[0] as {
                factory: (data: unknown, ctx: ExecutionContext) => string
            }
        ).factory
    })()

    it('returns the club the guards resolved', () => {
        expect(
            factory(undefined, ctx({ query: { workspaceId: 'w1' }, body: {} })),
        ).toBe('w1')
    })

    it('refuses a request without a club', () => {
        expect(() => factory(undefined, ctx({ query: {}, body: {} }))).toThrow(
            'Не указан клуб',
        )
    })

    it('refuses a request naming two clubs', () => {
        expect(() => factory(undefined, ctx({ ...MIXED }))).toThrow(
            BadRequestError,
        )
    })
})
