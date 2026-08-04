import { ExecutionContext } from '@nestjs/common'

import { ForbiddenError } from '../errors/shared.errors'
import { SuperAdminGuard } from './super-admin.guard'

type UserStub = {
    isSuperAdmin?: boolean
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
