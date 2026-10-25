import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeclineSubscriptionFreezeRequestFeature,
    DeclineSubscriptionFreezeRequestFeatureResponse,
} from './decline-subscription-freeze-request.feature'
import { loadDecidableRequest, RACE_MESSAGE } from './freeze-request-access'
import { closeRequestData, personName } from './freeze-request-utils'
import { sendFreezeRequestNotice } from './notify-freeze-request'
import { serializeFreezeRequest } from './schemas'

@Feature(DeclineSubscriptionFreezeRequestFeature)
export class DeclineSubscriptionFreezeRequestHandler
    implements
        IFeatureHandler<
            DeclineSubscriptionFreezeRequestFeature,
            DeclineSubscriptionFreezeRequestFeatureResponse
        >
{
    private readonly logger = new Logger(
        DeclineSubscriptionFreezeRequestHandler.name,
    )

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeclineSubscriptionFreezeRequestFeature) {
        const row = await loadDecidableRequest(this.prisma, this.rbac, f)

        const comment = f.payload.comment || null
        const moved = await this.prisma.subscriptionFreezeRequest.updateMany({
            where: { id: row.id, status: 'PENDING' },
            data: closeRequestData('DECLINED', {
                decidedById: f.invokerUserId,
                decidedAt: new Date(),
                decisionComment: comment,
            }),
        })
        if (moved.count !== 1) {
            throw new ConflictError({ message: RACE_MESSAGE })
        }

        const fresh = await this.prisma.subscriptionFreezeRequest.findUniqueOrThrow(
            {
                where: { id: row.id },
                include: {
                    decidedBy: { select: { firstname: true, lastname: true } },
                },
            },
        )
        const planName = row.subscription.plan.name

        await this.audit.record({
            action: 'member.declineFreezeRequest',
            targetType: 'member',
            targetId: row.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                planName,
                fromDate: dbDateToYmd(row.fromDate),
                days: row.days,
                reason: row.reason,
                comment,
            },
        })

        this.realtime.invalidate(f.workspaceId, [
            'subscription',
            'freeze-requests',
        ])

        await sendFreezeRequestNotice(this.notifications, this.logger, {
            kind: 'freeze.declined',
            refBase: `${row.id}:declined`,
            recipients: [row.userId],
            workspaceId: f.workspaceId,
            freezeRequestId: row.id,
            memberUserId: row.userId,
            topic: 'Заявка на заморозку отклонена',
            message: comment
                ? `${personName(fresh.decidedBy) ?? 'Тренер'}: «${comment}»`
                : 'Если есть вопросы — свяжитесь с тренером группы',
        })

        return serializeFreezeRequest(fresh)
    }
}
