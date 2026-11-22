import { ExecutionContext } from '@nestjs/common'

import { ForbiddenError, PlatformMfaRequiredError } from '../errors/shared.errors'
import { SuperAdminGuard } from './super-admin.guard'

type UserStub = {
    isSuperAdmin?: boolean
    superAdminMfaMissing?: boolean
    role?: { name: string }
} | null

const buildContext = (user: UserStub): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    }) as unknown as ExecutionContext

const guard = new SuperAdminGuard()

describe('SuperAdminGuard', () => {
    it('admits a platform super admin', () => {
        expect(guard.canActivate(buildContext({ isSuperAdmin: true }))).toBe(
            true,
        )
    })

    // A super-admin account whose session lacks the required authenticator:
    // AuthGuard took its powers; the answer tells the admin app to set it up.
    it('asks a super admin without the second factor to set it up', () => {
        const context = buildContext({
            isSuperAdmin: false,
            superAdminMfaMissing: true,
        })
        expect(() => guard.canActivate(context)).toThrow(PlatformMfaRequiredError)
        expect(() => guard.canActivate(context)).toThrow(
            'Включите двухфакторную защиту',
        )
    })

    it('rejects an unauthenticated request', () => {
        expect(() => guard.canActivate(buildContext(null))).toThrow(
            ForbiddenError,
        )
    })

    it('rejects a plain member', () => {
        expect(() =>
            guard.canActivate(
                buildContext({ isSuperAdmin: false, role: { name: 'user' } }),
            ),
        ).toThrow(ForbiddenError)
    })

    // The whole point of the guard: club-level power must not leak upward.
    // A workspace 'admin' runs their own club, not the platform.
    it('rejects a workspace admin', () => {
        expect(() =>
            guard.canActivate(
                buildContext({ isSuperAdmin: false, role: { name: 'admin' } }),
            ),
        ).toThrow(ForbiddenError)
    })

    it('rejects when isSuperAdmin is absent rather than defaulting open', () => {
        expect(() => guard.canActivate(buildContext({}))).toThrow(
            ForbiddenError,
        )
    })
})
