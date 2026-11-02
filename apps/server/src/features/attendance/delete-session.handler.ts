import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { cap, loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import {
    DeleteSessionFeature,
    DeleteSessionFeatureResponse,
} from './delete-session.feature'
import { loadSessionForWrite } from './session-access'

@Feature(DeleteSessionFeature)
export class DeleteSessionHandler
    implements
        IFeatureHandler<DeleteSessionFeature, DeleteSessionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: DeleteSessionFeature) {
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
            // A substitute marks the class; deleting it stays with its group.
            'manage',
        )
        if (session.isPersonal) {
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new BadRequestError({
                message: `${cap(v.personalSession.acc)} отменяют в заявке`,
            })
        }
        // Records cascade via the AttendanceRecord FK.
        await this.prisma.attendanceSession.delete({
            where: { id: session.id },
        })
        return { status: 'deleted' as const }
    }
}
