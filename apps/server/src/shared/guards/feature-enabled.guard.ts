import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import {
    featureFlagSelect,
    toFeatureFlags,
} from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import type { CurrentUserPayload } from '../decorators/current-user.decorator'
import { RequiresFeature } from '../decorators/requires-feature.decorator'
import { STAFF_ROLES, type RoleName } from '../decorators/roles.decorator'
import { ForbiddenError } from '../errors/shared.errors'

// Refuses a member route whose app section the club has switched off, so a
// block hidden in the app is not reachable by calling the API directly. Routes
// opt in with @RequiresFeature('<key>'); place it after WorkspaceMemberGuard.
// Owner, staff and platform admins pass (they manage the section from the
// admin); a route with no workspaceId fails closed.
@Injectable()
export class FeatureEnabledGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
    ) {}

    async canActivate(context: ExecutionContext) {
        const key = this.reflector.getAllAndOverride(RequiresFeature, [
            context.getHandler(),
            context.getClass(),
        ])
        if (!key) return true

        const request = context.switchToHttp().getRequest()
        const user = request?.user as CurrentUserPayload | undefined
        if (user?.isSuperAdmin) return true
        if (STAFF_ROLES.includes((user?.role?.name ?? '') as RoleName)) {
            return true
        }

        const workspaceId =
            request?.params?.workspaceId ?? request?.query?.workspaceId
        if (!workspaceId) {
            throw new ForbiddenError({
                message: 'Этот раздел отключён в вашем клубе',
            })
        }

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: featureFlagSelect,
        })
        if (!workspace || !toFeatureFlags(workspace)[key]) {
            throw new ForbiddenError({
                message: 'Этот раздел отключён в вашем клубе',
            })
        }
        return true
    }
}
