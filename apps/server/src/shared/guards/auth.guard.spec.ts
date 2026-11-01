// environment.ts reads required env vars at import; stub the one value the
// guard reads.
jest.mock('../../environments/environment', () => ({
    environment: { consent: { personalDataVersion: 'v2' } },
}))

import { SetMetadata } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

import { TokensService } from '../../domains/tokens/services/tokens.service'
import { SKIP_CONSENT_CHECK } from '../decorators/skip-consent-check.decorator'
import { UnauthorizedError } from '../errors/shared.errors'
import { AuthGuard } from './auth.guard'

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
