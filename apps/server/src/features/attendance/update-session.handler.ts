import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeSession } from './schemas'
import { loadSessionForWrite } from './session-access'
import {
    UpdateSessionFeature,
    UpdateSessionFeatureResponse,
} from './update-session.feature'

@Feature(UpdateSessionFeature)
export class UpdateSessionHandler
    implements
        IFeatureHandler<UpdateSessionFeature, UpdateSessionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdateSessionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        // 404 if missing + group/event write-scope check (same gate as delete).
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )

        const trimmed = f.payload.notes?.trim()
        const updated = await this.prisma.attendanceSession.update({
            where: { id: session.id },
            data: { notes: trimmed ? trimmed : null },
            include: { _count: { select: { records: true } } },
        })
        return serializeSession(updated)
    }
}
