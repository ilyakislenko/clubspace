import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'
import {
    UnmarkRecordFeature,
    UnmarkRecordFeatureResponse,
} from './unmark-record.feature'

@Feature(UnmarkRecordFeature)
export class UnmarkRecordHandler
    implements
        IFeatureHandler<UnmarkRecordFeature, UnmarkRecordFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UnmarkRecordFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )

        // deleteMany so un-marking a not-present user is a no-op success.
        await this.prisma.attendanceRecord.deleteMany({
            where: { sessionId: session.id, userId: f.userId },
        })

        return buildRoster(this.prisma, session)
    }
}
