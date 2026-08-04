import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { ForbiddenError } from '../errors/shared.errors'

// Gate for platform-level endpoints (`/platform/*`) — the console that sits
// ABOVE the per-workspace admin: it lists every club, creates new ones and
// hands them to an owner.
//
// Note the direction, because it is the opposite of RoleGuard's: RoleGuard
// *lets a super admin through* whatever @Roles says, while this guard *admits
// nobody else*. It deliberately does not consult @Roles or the workspace role
// at all — platform powers are not a workspace role, and a club admin must
// never reach these routes by being an admin of their own club.
//
// There is no owner bypass here either: being the owner of a workspace says
// nothing about the platform.
@Injectable()
export class SuperAdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<{
            user?: CurrentUserPayload
        }>()
        const user = req.user

        if (!user) {
            throw new ForbiddenError({ message: 'No authenticated user' })
        }
        if (!user.isSuperAdmin) {
            throw new ForbiddenError({
                message: 'Platform administrator access required',
            })
        }
        return true
    }
}
