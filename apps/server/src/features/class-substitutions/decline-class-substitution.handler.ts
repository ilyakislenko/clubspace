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
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import {
    loadDecider,
    loadSubstitutionOrThrow,
} from './class-substitution-access'
import {
    DeclineClassSubstitutionFeature,
    DecideClassSubstitutionFeatureResponse,
} from './decide-class-substitution.feature'
import { notifyClassSubstitution } from './notify-class-substitution'

// Whoever runs the group turns a coach's offer down; the row goes (the audit
// log keeps it), so the class is open for another request.
@Feature(DeclineClassSubstitutionFeature)
export class DeclineClassSubstitutionHandler
    implements
        IFeatureHandler<
            DeclineClassSubstitutionFeature,
            DecideClassSubstitutionFeatureResponse
        >
{
    private readonly logger = new Logger(DeclineClassSubstitutionHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeclineClassSubstitutionFeature) {
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
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new ForbiddenError({
                message: `Отклонить замену может ${v.coach.nom} группы, руководитель направления или администратор клуба`,
            })
        }
        const removed = await this.prisma.classSubstitution.deleteMany({
            where: { id: row.id, status: 'PENDING' },
        })
        if (removed.count === 0) {
            throw new ConflictError({
                message: 'Замена уже одобрена или отозвана — обновите экран',
            })
        }

        await this.audit.record({
            action: 'group.substituteDecline',
            targetType: 'group',
            targetId: row.groupId,
            workspaceId: f.workspaceId,
            actorId: ctx.userId,
            metadata: {
                substitutionId: row.id,
                slotId: row.slotId,
                sessionDate: row.sessionDate.toISOString().slice(0, 10),
                substituteId: row.substituteId,
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
            'declined',
            ctx.userId,
        )
        return { substitution: null }
    }
}
