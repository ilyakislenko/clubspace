import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { Roles } from '../decorators/roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'

// Role-based gate for admin endpoints. Reads the @Roles() metadata from
// the handler and rejects if the current user's role isn't on the list.
// Workspace owner and platform superuser always pass — owner because
// they can't lock themselves out, superuser because that's our staff
// console with global powers.
@Injectable()
export class RoleGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const allowed = this.reflector.get(Roles, context.getHandler())
        if (!allowed || allowed.length === 0) return true

        const req = context.switchToHttp().getRequest<{
            user?: CurrentUserPayload
        }>()
        const user = req.user

        if (!user) {
            throw new ForbiddenError({ message: 'No authenticated user' })
        }
        if (user.isSuperAdmin) return true

        const roleName = user.role?.name
        if (!roleName) {
            throw new ForbiddenError({ message: 'No role for this workspace' })
        }
        // Widen `allowed` to readonly string[] so `.includes()` accepts
        // an arbitrary string. Cleaner than `roleName as never`, which
        // was a type-escape that silently swallows mismatches.
        if (!(allowed as readonly string[]).includes(roleName)) {
            throw new ForbiddenError({
                message: `Role '${roleName}' is not allowed here`,
            })
        }
        return true
    }
}
