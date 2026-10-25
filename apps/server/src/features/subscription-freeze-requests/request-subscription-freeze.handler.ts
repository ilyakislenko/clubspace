import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import {
    formatFreezeRange,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { findOpenFreeze } from '../../domains/subscriptions/services/subscription-freeze.service'
import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { localDateInTz } from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import { findFreezeRequestDeciders } from './freeze-request-recipients'
import { memberFreezeRefusal, requestRange } from './freeze-request-utils'
import { sendFreezeRequestNotice } from './notify-freeze-request'
import {
    RequestSubscriptionFreezeFeature,
    RequestSubscriptionFreezeFeatureResponse,
} from './request-subscription-freeze.feature'
import { serializeFreezeRequest } from './schemas'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

@Feature(RequestSubscriptionFreezeFeature)
export class RequestSubscriptionFreezeHandler
    implements
        IFeatureHandler<
            RequestSubscriptionFreezeFeature,
            RequestSubscriptionFreezeFeatureResponse
        >
{
    private readonly logger = new Logger(RequestSubscriptionFreezeHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: RequestSubscriptionFreezeFeature) {
        const member = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId: f.workspaceId, userId: f.invokerUserId },
            select: {
                id: true,
                subscriptionId: true,
                user: {
                    select: { firstname: true, lastname: true, email: true },
                },
                workspace: { select: { timezone: true, ownerId: true } },
            },
        })
        // Also covers the owner and a super admin: no member row, no abonement.
        if (!member) throw new NotFoundError({ message: 'Абонемент не найден' })

        // Only through the member's pointer, and only while it is still usable.
        const sub = member.subscriptionId
            ? await this.prisma.subscription.findFirst({
                  where: {
                      id: member.subscriptionId,
                      workspaceId: f.workspaceId,
                      workspaceMemberId: member.id,
                  },
                  include: { plan: { select: { name: true } } },
              })
            : null
        const now = new Date()
        if (!sub || !isSubscriptionUsable(sub, now)) {
            throw new BadRequestError({
                message: 'У вас нет действующего абонемента',
            })
        }

        const tz = member.workspace.timezone
        const refusal = memberFreezeRefusal({
            fromYmd: f.payload.fromDate,
            days: f.payload.days,
            now,
            tz,
            subscription: sub,
        })
        if (refusal) throw new BadRequestError({ message: refusal })

        const open = await findOpenFreeze(this.prisma, {
            subscriptionId: sub.id,
            todayYmd: localDateInTz(now, tz),
        })
        if (open) {
            throw new BadRequestError({
                message: `У абонемента уже есть заморозка ${formatFreezeRange(open)}`,
            })
        }

        let created
        try {
            created = await this.prisma.subscriptionFreezeRequest.create({
                data: {
                    workspaceId: f.workspaceId,
                    subscriptionId: sub.id,
                    userId: f.invokerUserId,
                    pendingSubscriptionId: sub.id,
                    fromDate: ymdToDbDate(f.payload.fromDate),
                    days: f.payload.days,
                    reason: f.payload.reason,
                },
            })
        } catch (err) {
            if (!isP2002(err)) throw err
            throw new ConflictError({
                message:
                    'Вы уже отправили заявку на заморозку — дождитесь ответа тренера или отмените её',
            })
        }

        this.realtime.invalidate(f.workspaceId, [
            'subscription',
            'freeze-requests',
        ])

        // Best-effort as a whole: the request is already saved.
        try {
            const recipients = await findFreezeRequestDeciders(this.prisma, {
                workspaceId: f.workspaceId,
                ownerId: member.workspace.ownerId,
                memberUserId: f.invokerUserId,
            })
            await sendFreezeRequestNotice(this.notifications, this.logger, {
                kind: 'freeze.requested',
                refBase: `${created.id}:requested`,
                recipients,
                workspaceId: f.workspaceId,
                freezeRequestId: created.id,
                memberUserId: f.invokerUserId,
                topic: 'Заявка на заморозку',
                message: `${displayName(member.user)} просит заморозить абонемент ${formatFreezeRange(requestRange(created))} (${created.days} дн.) · ${created.reason}`,
            })
        } catch (err) {
            this.logger.warn(
                `Freeze request notification failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }

        return serializeFreezeRequest(created)
    }
}
