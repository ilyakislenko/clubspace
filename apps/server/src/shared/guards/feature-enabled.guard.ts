import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import {
    featureFlagSelect,
    toFeatureFlags,
} from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import { RequiresFeature } from '../decorators/requires-feature.decorator'
import { ForbiddenError } from '../errors/shared.errors'

// Refuses a member route whose app section the club has switched off, so a
// block hidden in the app is not reachable by calling the API directly. Routes
// opt in with @RequiresFeature('<key>'); place it after WorkspaceMemberGuard.
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
        const workspaceId = request?.params?.workspaceId
        if (!workspaceId) return true

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
