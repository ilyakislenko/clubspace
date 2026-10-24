import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import {
    COACHING_ROLES,
    Roles,
    WORKSPACE_ADMINS,
} from '../decorators/roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'
import { RoleGuard } from './role.guard'

// Test controllers carrying REAL @Roles metadata, so the guard is exercised
// against the same Reflector mechanism production uses. The original bug was
// that class-level @Roles was silently ignored — these doubles reproduce both
// declaration styles to lock that down.
@Roles(COACHING_ROLES)
class ClassLevelController {
    open() {}

    @Roles(WORKSPACE_ADMINS)
    overridden() {}
}

class MethodLevelController {
    @Roles(COACHING_ROLES)
    guarded() {}

    unguarded() {}
}

type UserStub = {
    isSuperAdmin?: boolean
    role?: { name: string }
} | null

const buildContext = (
    target: object,
    handler: (...args: never[]) => unknown,
    user: UserStub,
): ExecutionContext =>
    ({
        getHandler: () => handler,
        getClass: () => target,
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    }) as unknown as ExecutionContext

const guard = new RoleGuard(new Reflector())

describe('RoleGuard', () => {
    describe('class-level @Roles (the previously-bypassed style)', () => {
        it('enforces the role declared on the controller class', () => {
            const ctx = buildContext(
                ClassLevelController,
                ClassLevelController.prototype.open,
                { role: { name: 'user' } },
            )
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenError)
        })

        it('admits a member whose role is on the class list', () => {
            const ctx = buildContext(
                ClassLevelController,
                ClassLevelController.prototype.open,
                { role: { name: 'coach' } },
            )
            expect(guard.canActivate(ctx)).toBe(true)
        })

        it('lets a method-level @Roles override the class list', () => {
            // class is COACHING_ROLES (coach passes), overridden() is
            // WORKSPACE_ADMINS (coach does not)
            const ctx = buildContext(
                ClassLevelController,
                ClassLevelController.prototype.overridden,
                { role: { name: 'coach' } },
            )
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenError)
        })
    })

    describe('method-level @Roles', () => {
        it('enforces the role declared on the handler', () => {
            const ctx = buildContext(
                MethodLevelController,
                MethodLevelController.prototype.guarded,
                { role: { name: 'user' } },
            )
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenError)
        })

        it('is open when neither handler nor class declares @Roles', () => {
            const ctx = buildContext(
                MethodLevelController,
                MethodLevelController.prototype.unguarded,
                { role: { name: 'user' } },
            )
            expect(guard.canActivate(ctx)).toBe(true)
        })
    })

    describe('bypasses and rejections', () => {
        it('always admits the platform superadmin', () => {
            const ctx = buildContext(
                ClassLevelController,
                ClassLevelController.prototype.open,
                { isSuperAdmin: true },
            )
            expect(guard.canActivate(ctx)).toBe(true)
        })

        it('throws when there is no authenticated user', () => {
            const ctx = buildContext(
                ClassLevelController,
                ClassLevelController.prototype.open,
                null,
            )
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenError)
        })

        it('throws when the user has no role for this workspace', () => {
            const ctx = buildContext(
                ClassLevelController,
                ClassLevelController.prototype.open,
                {},
            )
            expect(() => guard.canActivate(ctx)).toThrow(ForbiddenError)
        })
    })
})
