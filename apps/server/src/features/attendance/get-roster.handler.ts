import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetSessionRosterFeature,
    GetSessionRosterFeatureResponse,
} from './get-roster.feature'
import { buildRoster } from './roster'
import { loadSessionForRead } from './session-access'

@Feature(GetSessionRosterFeature)
export class GetSessionRosterHandler
    implements
        IFeatureHandler<
            GetSessionRosterFeature,
            GetSessionRosterFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetSessionRosterFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForRead(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )
        return buildRoster(this.prisma, session)
    }
}
