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
    ApproveClassSubstitutionFeature,
    DecideClassSubstitutionFeatureResponse,
} from './decide-class-substitution.feature'
import { notifyClassSubstitution } from './notify-class-substitution'
import { serializeClassSubstitution } from './schemas'

// «Дал добро»: whoever runs the group approves a coach's offer to take the
// class.
@Feature(ApproveClassSubstitutionFeature)
export class ApproveClassSubstitutionHandler
    implements
        IFeatureHandler<
            ApproveClassSubstitutionFeature,
            DecideClassSubstitutionFeatureResponse
        >
{
    private readonly logger = new Logger(ApproveClassSubstitutionHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ApproveClassSubstitutionFeature) {
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
        if (!(await loadDecider(this.rbac, ctx))(row.group)) {
            throw new ForbiddenError({
                message:
                    'Одобрить замену может тренер группы, руководитель направления или администратор клуба',
            })
        }
        const moved = await this.prisma.classSubstitution.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: {
                status: 'APPROVED',
                decidedById: ctx.userId,
                decidedAt: new Date(),
            },
        })
        if (moved.count === 0) {
            throw new ConflictError({
                message: 'Замена уже одобрена или отозвана — обновите экран',
            })
        }
        const fresh = await loadSubstitutionOrThrow(
            this.prisma,
            f.workspaceId,
            row.id,
        )
        await syncSessionCoach(this.prisma, fresh, fresh.substituteId)

        await this.audit.record({
            action: 'group.substituteApprove',
            targetType: 'group',
            targetId: fresh.groupId,
            workspaceId: f.workspaceId,
            actorId: ctx.userId,
            metadata: {
                substitutionId: fresh.id,
                slotId: fresh.slotId,
                sessionDate: fresh.sessionDate.toISOString().slice(0, 10),
                substituteId: fresh.substituteId,
            },
        })
        this.realtime.invalidate(f.workspaceId, ['schedule', 'substitutions'])
        await notifyClassSubstitution(
            {
                prisma: this.prisma,
                notifications: this.notifications,
                logger: this.logger,
            },
            fresh,
            'approved',
            ctx.userId,
        )
        return {
            substitution: serializeClassSubstitution(fresh, {
                userId: ctx.userId,
                canDecide: true,
            }),
        }
    }
}
