import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { OrgRbacService } from '../../domains/organizations/org-access'
import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { OrgRoles } from '../decorators/org-roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'

// The org console's door (`orgs/:organizationId/*`), the counterpart of
// WorkspaceMemberGuard + RoleGuard for an organization: the hub must be on
// (ORGANIZATIONS_ENABLED), the caller org staff (404 otherwise — no existence
// leak) and of a role @OrgRoles lists. The platform super admin passes as an
// org admin. Handlers repeat the tier with assertOrgAdmin / assertOrgStaff.
@Injectable()
export class OrganizationMemberGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<{
            user?: CurrentUserPayload
            params?: Record<string, string | undefined>
        }>()
        const user = request.user
        if (!user?.userId) throw new ForbiddenError()

        const scope = await this.orgRbac.resolveOrgScope({
            userId: user.userId,
            organizationId: request.params?.organizationId ?? '',
            isSuperAdmin: user.isSuperAdmin,
        })

        const allowed = this.reflector.getAllAndOverride(OrgRoles, [
            context.getHandler(),
            context.getClass(),
        ])
        if (allowed && allowed.length > 0 && !allowed.includes(scope.role)) {
            throw new ForbiddenError({
                message: 'Раздел доступен администраторам федерации',
            })
        }
        return true
    }
}
