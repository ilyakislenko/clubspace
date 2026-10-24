import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { Roles } from '../decorators/roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'

// Role-based gate for admin endpoints. Reads the @Roles() metadata and
// rejects if the current user's role isn't on the list. Metadata is read
// from BOTH the handler and the class (handler wins) so @Roles() works
// whether declared per-method or once on the controller — a plain
// reflector.get(getHandler()) silently ignores class-level @Roles and
// lets everyone through.
// The platform superuser always passes — that's our staff console with
// global powers. A club owner passes because AuthGuard resolves them to the
// workspace 'admin' role before this guard runs (when they hold no
// WorkspaceMember row, or one whose role is below admin); there is deliberately no separate
// ownership check here, so this guard has exactly one question to answer.
@Injectable()
export class RoleGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const allowed = this.reflector.getAllAndOverride(Roles, [
            context.getHandler(),
            context.getClass(),
        ])
        if (!allowed || allowed.length === 0) return true

        const req = context.switchToHttp().getRequest<{
            user?: CurrentUserPayload
        }>()
        const user = req.user

        if (!user) {
            throw new ForbiddenError({ message: 'Нужно войти в аккаунт' })
        }
        if (user.isSuperAdmin) return true

        const roleName = user.role?.name
        if (!roleName) {
            throw new ForbiddenError({ message: 'В этом клубе у вас нет роли' })
        }
        // Widen `allowed` to readonly string[] so `.includes()` accepts
        // an arbitrary string. Cleaner than `roleName as never`, which
        // was a type-escape that silently swallows mismatches.
        if (!(allowed as readonly string[]).includes(roleName)) {
            throw new ForbiddenError({
                message: `Роль «${roleName}» здесь не разрешена`,
            })
        }
        return true
    }
}
