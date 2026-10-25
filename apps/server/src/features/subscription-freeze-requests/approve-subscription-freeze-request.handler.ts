import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import {
    dbDateToYmd,
    formatFreezeRange,
} from '../../domains/subscriptions/freeze-dates'
import { SubscriptionFreezeService } from '../../domains/subscriptions/services/subscription-freeze.service'
import { PrismaService } from '../../infrastructure/prisma'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDateInTz } from '../attendance/attendance-utils'
import { serializeSubscriptionFreeze } from '../member-subscriptions/schemas'
import {
    ApproveSubscriptionFreezeRequestFeature,
    ApproveSubscriptionFreezeRequestFeatureResponse,
} from './approve-subscription-freeze-request.feature'
import { loadDecidableRequest, RACE_MESSAGE } from './freeze-request-access'
import { approvalStartYmd, closeRequestData } from './freeze-request-utils'
import { sendFreezeRequestNotice } from './notify-freeze-request'
import { serializeFreezeRequest } from './schemas'

@Feature(ApproveSubscriptionFreezeRequestFeature)
export class ApproveSubscriptionFreezeRequestHandler
    implements
        IFeatureHandler<
            ApproveSubscriptionFreezeRequestFeature,
            ApproveSubscriptionFreezeRequestFeatureResponse
        >
{
    private readonly logger = new Logger(
        ApproveSubscriptionFreezeRequestHandler.name,
    )

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly freezes: SubscriptionFreezeService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ApproveSubscriptionFreezeRequestFeature) {
        const row = await loadDecidableRequest(this.prisma, this.rbac, f)

        const now = new Date()
        const today = localDateInTz(now, row.workspace.timezone)
        const requestedFrom = dbDateToYmd(row.fromDate)
        // A start that has already passed becomes today (the service forbids
        // past starts); the requested length is kept.
        const fromYmd =
            f.payload.fromDate ?? approvalStartYmd(requestedFrom, today)
        const days = f.payload.days ?? row.days
        const reason = f.payload.reason || row.reason

        // One transaction: if the freeze is refused (limits, pointer, an open
        // freeze), the claim rolls back and the request stays PENDING.
        const { request, freeze } = await this.prisma.$transaction(
            async (tx) => {
                const claimed = await tx.subscriptionFreezeRequest.updateMany({
                    where: { id: row.id, status: 'PENDING' },
                    data: closeRequestData('APPROVED', {
                        decidedById: f.invokerUserId,
                        decidedAt: now,
                    }),
                })
                if (claimed.count !== 1) {
                    throw new ConflictError({ message: RACE_MESSAGE })
                }
                const created = await this.freezes.createInTx(tx, {
                    workspaceId: f.workspaceId,
                    userId: row.userId,
                    subscriptionId: row.subscriptionId,
                    days,
                    fromDate: fromYmd,
                    reason,
                    now,
                })
                const fresh =
                    await tx.subscriptionFreezeRequest.findUniqueOrThrow({
                        where: { id: row.id },
                        include: {
                            decidedBy: {
                                select: { firstname: true, lastname: true },
                            },
                        },
                    })
                return {
                    request: fresh,
                    freeze: created.freeze,
                }
            },
        )

        const out = serializeSubscriptionFreeze(freeze)
        const planName = row.subscription.plan.name

        await this.audit.record({
            action: 'member.approveFreezeRequest',
            targetType: 'member',
            targetId: row.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                planName,
                fromDate: out.fromDate,
                untilDate: out.untilDate,
                days: out.days,
                reason: out.reason,
                requestedFromDate: requestedFrom,
                requestedDays: row.days,
            },
        })

        // The freeze moved endDate (and maybe accessUntil), like a direct one.
        this.realtime.invalidate(f.workspaceId, [
            'members',
            'subscription',
            'attendance',
            'freeze-requests',
        ])

        await sendFreezeRequestNotice(this.notifications, this.logger, {
            kind: 'freeze.approved',
            refBase: `${row.id}:approved`,
            recipients: [row.userId],
            workspaceId: f.workspaceId,
            freezeRequestId: row.id,
            memberUserId: row.userId,
            topic: 'Заморозка одобрена',
            message: `Абонемент «${planName}» заморожен ${formatFreezeRange(freeze)} — срок продлён на ${out.days} дн.`,
        })

        return {
            request: serializeFreezeRequest(request),
            freeze: out,
        }
    }
}
