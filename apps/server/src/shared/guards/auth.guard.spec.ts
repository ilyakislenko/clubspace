// environment.ts reads required env vars at import; stub the one value the
// guard reads.
jest.mock('../../environments/environment', () => ({
    environment: { consent: { personalDataVersion: 'v2' } },
}))

import { SetMetadata } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

import { TokensService } from '../../domains/tokens/services/tokens.service'
import { ActAsAllowed } from '../decorators/act-as.decorator'
import { COACHING_ROLES, Roles } from '../decorators/roles.decorator'
import { SKIP_CONSENT_CHECK } from '../decorators/skip-consent-check.decorator'
import {
    BadRequestError,
    ForbiddenError,
    UnauthorizedError,
} from '../errors/shared.errors'
import { AuthGuard } from './auth.guard'

const KID = '0b5f7a52-4f7e-4bd2-9a59-2f0f3c1f4a11'

// A guardian ('g1') sending X-Act-As for KID.
const buildActAs = (
    o: {
        linked?: boolean
        superAdmin?: boolean
        // Route shape: decorators applied to the handler, and the request's
        // workspace (none = a user-level route).
        decorate?: (handler: () => void) => void
        workspaceId?: string | null
        method?: string
        header?: string
    } = {},
) => {
    const rolesService = {
        getRole: jest.fn().mockResolvedValue(role('user', false)),
        getRoleForWorkspaceOwner: jest.fn().mockResolvedValue(null),
    }
    const usersService = {
        getUserById: jest.fn().mockResolvedValue({
            status: 'ACTIVE',
            isSuperAdmin: o.superAdmin ?? false,
            sessionVersion: 0,
            // The guardian's own consent is what the gate checks.
            personalDataConsentVersion: 'v2',
        }),
        isActiveGuardian: jest.fn().mockResolvedValue(o.linked ?? true),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const guard = new AuthGuard(
        {
            verifyToken: jest.fn().mockResolvedValue({ sub: 'g1', sv: 0 }),
        } as never,
        new Reflector(),
        rolesService as never,
        usersService as never,
        audit as never,
    )
    const handler = () => undefined
    o.decorate?.(handler)
    const workspaceId = o.workspaceId === undefined ? 'w1' : o.workspaceId
    const req: Record<string, unknown> = {
        method: o.method ?? 'GET',
        url: '/workspaces/w1/me/subscription?x=1',
        headers: { authorization: 'Bearer t', 'x-act-as': o.header ?? KID },
        params: workspaceId ? { workspaceId } : {},
        query: {},
    }
    const context = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => handler,
        getClass: () => class {},
    }
    return { guard, req, context, rolesService, usersService, audit }
}

type ActedUser = {
    userId: string
    guardianId: string | null
    isSuperAdmin: boolean
}

describe('AuthGuard X-Act-As', () => {
    it('makes the dependent the effective user on a member route of a club', async () => {
        const { guard, req, context, rolesService, usersService } = buildActAs()
        await guard.canActivate(context as never)
        expect(usersService.isActiveGuardian).toHaveBeenCalledWith({
            guardianId: 'g1',
            dependentId: KID,
        })
        const user = req.user as ActedUser
        expect(user.userId).toBe(KID)
        expect(user.guardianId).toBe('g1')
        // The child's own role in that club, not the guardian's.
        expect(rolesService.getRole).toHaveBeenCalledWith({
            userId: KID,
            workspaceId: 'w1',
        })
    })

    it("refuses someone else's child", async () => {
        const { guard, context } = buildActAs({ linked: false })
        await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('refuses a staff-only route even for an own child', async () => {
        const { guard, context, usersService } = buildActAs({
            decorate: (h) => Roles(COACHING_ROLES)(h),
        })
        await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(usersService.isActiveGuardian).not.toHaveBeenCalled()
    })

    it('refuses a user-level route that did not opt in (account, devices, …)', async () => {
        const { guard, context } = buildActAs({ workspaceId: null })
        await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('accepts a user-level route marked @ActAsAllowed', async () => {
        const { guard, req, context } = buildActAs({
            workspaceId: null,
            decorate: (h) => ActAsAllowed()(h),
        })
        await guard.canActivate(context as never)
        expect((req.user as ActedUser).userId).toBe(KID)
    })

    it('records every write made for the child against the guardian', async () => {
        const { guard, context, audit } = buildActAs({ method: 'POST' })
        await guard.canActivate(context as never)
        expect(audit.record).toHaveBeenCalledWith({
            action: 'guardian.actAs',
            targetType: 'member',
            targetId: KID,
            workspaceId: 'w1',
            actorId: 'g1',
            metadata: { method: 'POST', path: '/workspaces/w1/me/subscription' },
        })
    })

    it('does not record reads', async () => {
        const { guard, context, audit } = buildActAs()
        await guard.canActivate(context as never)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it("drops a platform admin's powers while acting for a child", async () => {
        const { guard, req, context } = buildActAs({ superAdmin: true })
        await guard.canActivate(context as never)
        const user = req.user as ActedUser & { role: { name: string } }
        expect(user.isSuperAdmin).toBe(false)
        expect(user.role.name).toBe('user')
    })

    it('rejects a malformed profile id before any lookup', async () => {
        const { guard, context, usersService } = buildActAs({ header: 'nope' })
        await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(usersService.isActiveGuardian).not.toHaveBeenCalled()
    })

    it('acts as the signed-in user without the header', async () => {
        const { guard, req, context, usersService } = buildActAs()
        ;(req.headers as Record<string, string>)['x-act-as'] = ''
        await guard.canActivate(context as never)
        expect((req.user as ActedUser).userId).toBe('g1')
        expect((req.user as ActedUser).guardianId).toBeNull()
        expect(usersService.isActiveGuardian).not.toHaveBeenCalled()
    })
})

const role = (name: string, isWorkspaceOwner: boolean) => ({
    id: `role-${name}`,
    name,
    superuser: false,
    editable: false,
    features: [],
    isWorkspaceOwner,
})

const build = (
    memberRole: ReturnType<typeof role>,
    opts: {
        tokens?: unknown
        sessionVersion?: number
        consentVersion?: string | null
        handler?: () => void
        isSuperAdmin?: boolean
    } = {},
) => {
    const adminRole = { ...role('admin', false), isWorkspaceOwner: undefined }
    const rolesService = {
        getRole: jest.fn().mockResolvedValue(memberRole),
        getRoleForWorkspaceOwner: jest.fn().mockResolvedValue(adminRole),
    }
    const guard = new AuthGuard(
        (opts.tokens ?? {
            verifyToken: jest.fn().mockResolvedValue({ sub: 'u1', sv: 0 }),
        }) as never,
        new Reflector(),
        rolesService as never,
        {
            getUserById: jest.fn().mockResolvedValue({
                status: 'ACTIVE',
                isSuperAdmin: opts.isSuperAdmin ?? false,
                sessionVersion: opts.sessionVersion ?? 0,
                personalDataConsentVersion:
                    opts.consentVersion === undefined
                        ? 'v2'
                        : opts.consentVersion,
            }),
        } as never,
        { record: jest.fn() } as never,
    )
    const req: Record<string, unknown> = {
        headers: { authorization: 'Bearer t' },
        params: { workspaceId: 'w1' },
        query: {},
    }
    const handler = opts.handler ?? (() => undefined)
    const context = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => handler,
        getClass: () => class {},
    }
    return { guard, rolesService, req, context }
}

describe('AuthGuard personal-data consent gate', () => {
    it('refuses an account that never accepted the consent', async () => {
        const { guard, rolesService, context } = build(role('user', false), {
            consentVersion: null,
        })
        await expect(guard.canActivate(context as never)).rejects.toMatchObject(
            { code: 'CONSENT_REQUIRED', statusCode: 403 },
        )
        // Refused before any workspace role lookup.
        expect(rolesService.getRole).not.toHaveBeenCalled()
    })

    it('refuses an account that accepted an older edition', async () => {
        const { guard, context } = build(role('user', false), {
            consentVersion: 'v1',
        })
        await expect(guard.canActivate(context as never)).rejects.toMatchObject(
            { code: 'CONSENT_REQUIRED' },
        )
    })

    it('refuses a super admin without consent too', async () => {
        const { guard, context } = build(role('user', false), {
            consentVersion: null,
            isSuperAdmin: true,
        })
        await expect(guard.canActivate(context as never)).rejects.toMatchObject(
            { code: 'CONSENT_REQUIRED' },
        )
    })

    it('lets a route marked @SkipConsentCheck through', async () => {
        const handler = () => undefined
        SetMetadata(SKIP_CONSENT_CHECK, true)(handler)
        const { guard, req, context } = build(role('user', false), {
            consentVersion: null,
            handler,
        })
        await guard.canActivate(context as never)
        expect((req.user as { userId: string }).userId).toBe('u1')
    })

    it('admits an account on the current edition', async () => {
        const { guard, req, context } = build(role('user', false))
        await guard.canActivate(context as never)
        expect((req.user as { role: { name: string } }).role.name).toBe('user')
    })
})

describe('AuthGuard owner role resolution', () => {
    it('lifts an owner whose member row is a coach to the admin role', async () => {
        const { guard, rolesService, req, context } = build(
            role('coach', true),
        )
        await guard.canActivate(context as never)
        expect(rolesService.getRoleForWorkspaceOwner).toHaveBeenCalled()
        expect((req.user as { role: { name: string } }).role.name).toBe(
            'admin',
        )
    })

    it('keeps a non-owner coach as coach', async () => {
        const { guard, rolesService, req, context } = build(
            role('coach', false),
        )
        await guard.canActivate(context as never)
        expect(rolesService.getRoleForWorkspaceOwner).not.toHaveBeenCalled()
        expect((req.user as { role: { name: string } }).role.name).toBe(
            'coach',
        )
    })

    it('leaves an owner who is already head_coach alone', async () => {
        const { guard, rolesService, req, context } = build(
            role('head_coach', true),
        )
        await guard.canActivate(context as never)
        expect(rolesService.getRoleForWorkspaceOwner).not.toHaveBeenCalled()
        expect((req.user as { role: { name: string } }).role.name).toBe(
            'head_coach',
        )
    })
})

describe('AuthGuard session checks', () => {
    // A real TokensService, so "refresh token refused" is the production
    // verification and not a stub's opinion.
    const tokensService = () =>
        new TokensService(
            {
                jwt: {
                    secret: 'test-secret-long-enough-for-hs256-token-signing',
                    issuerUrl: 'http://localhost:3000',
                    audienceUrl: 'http://localhost:3000',
                    accessTokenTTL: 900,
                    refreshTokenTTL: 3600,
                },
            } as never,
            new JwtService(),
            { refreshToken: { create: jest.fn() } } as never,
        )

    const withToken = async (token: string, sessionVersion = 0) => {
        const { guard, req, context } = build(role('user', false), {
            tokens: tokensService(),
            sessionVersion,
        })
        req.headers = { authorization: `Bearer ${token}` }
        return guard.canActivate(context as never)
    }

    it('accepts a current access token', async () => {
        const token = await tokensService().generateToken({
            userId: 'u1',
            sessionVersion: 0,
        })
        await expect(withToken(token)).resolves.toBeDefined()
    })

    it('refuses a refresh token used as an access token', async () => {
        const refresh = await tokensService().generateStoredToken({
            userId: 'u1',
        })
        await expect(withToken(refresh)).rejects.toBeInstanceOf(
            UnauthorizedError,
        )
    })

    it('refuses an access token issued before sessions were ended', async () => {
        const token = await tokensService().generateToken({
            userId: 'u1',
            sessionVersion: 0,
        })
        await expect(withToken(token, 1)).rejects.toBeInstanceOf(
            UnauthorizedError,
        )
    })
})
