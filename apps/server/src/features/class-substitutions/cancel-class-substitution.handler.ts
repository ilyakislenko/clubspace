import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ConflictError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    loadDecider,
    loadSubstitutionOrThrow,
    syncSessionCoach,
} from './class-substitution-access'
import {
    CancelClassSubstitutionFeature,
    DecideClassSubstitutionFeatureResponse,
} from './decide-class-substitution.feature'
import { notifyClassSubstitution } from './notify-class-substitution'

// Withdraws a substitution, pending or approved: whoever runs the group, the
// substitute, or whoever asked for it. The class returns to its own coaches.
@Feature(CancelClassSubstitutionFeature)
export class CancelClassSubstitutionHandler
    implements
        IFeatureHandler<
            CancelClassSubstitutionFeature,
            DecideClassSubstitutionFeatureResponse
        >
{
    private readonly logger = new Logger(CancelClassSubstitutionHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CancelClassSubstitutionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const row = await loadSubstitutionOrThrow(
            this.prisma,
            f.workspaceId,
            f.substitutionId,
        )
        const allowed =
            row.substituteId === ctx.userId ||
            row.requestedById === ctx.userId ||
            (await loadDecider(this.rbac, ctx))(row.group)
        if (!allowed) {
            throw new ForbiddenError({
                message:
                    'Отменить замену может тренер группы, сам заменяющий или администратор клуба',
            })
        }
        const removed = await this.prisma.classSubstitution.deleteMany({
            where: { id: row.id, status: row.status },
        })
        if (removed.count === 0) {
            throw new ConflictError({
                message: 'Замена уже изменилась — обновите экран',
            })
        }
        if (row.status === 'APPROVED') {
            await syncSessionCoach(this.prisma, row, row.group.coachId)
        }

        await this.audit.record({
            action: 'group.substituteCancel',
            targetType: 'group',
            targetId: row.groupId,
            workspaceId: f.workspaceId,
            actorId: ctx.userId,
            metadata: {
                substitutionId: row.id,
                slotId: row.slotId,
                sessionDate: row.sessionDate.toISOString().slice(0, 10),
                substituteId: row.substituteId,
                status: row.status,
            },
        })
        this.realtime.invalidate(f.workspaceId, ['schedule', 'substitutions'])
        await notifyClassSubstitution(
            {
                prisma: this.prisma,
                notifications: this.notifications,
                logger: this.logger,
            },
            row,
            'cancelled',
            ctx.userId,
        )
        return { substitution: null }
    }
}
