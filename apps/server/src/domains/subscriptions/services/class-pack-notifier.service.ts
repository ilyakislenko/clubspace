import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { currentSubscriptionWhere } from '../current-subscriptions'
import { vocabularyForWorkspaceType } from '../../../shared/utils/club-vocabulary'

@Injectable()
export class ClassPackNotifierService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    /**
     * After a check-in drew a class from these packs, tell each member whose
     * pack is now at 1 left or at 0. Deduped per (subscription, level). A
     * member holding several current abonements is told which one it is.
     */
    async notifyLowOrExhausted(
        subscriptionIds: string[],
        workspaceId: string,
    ): Promise<void> {
        if (subscriptionIds.length === 0) return
        const low = await this.prisma.subscription.findMany({
            where: {
                id: { in: subscriptionIds },
                classesRemaining: { in: [0, 1] },
            },
            select: {
                id: true,
                classesRemaining: true,
                plan: { select: { name: true } },
                workspace: { select: { type: true } },
                workspaceMember: {
                    select: {
                        userId: true,
                        _count: {
                            select: {
                                subscriptions: {
                                    where: currentSubscriptionWhere(new Date()),
                                },
                            },
                        },
                    },
                },
            },
        })
        for (const s of low) {
            const userId = s.workspaceMember?.userId
            if (!userId) continue
            const out = s.classesRemaining === 0
            const named = (s.workspaceMember?._count.subscriptions ?? 0) > 1
            const message = named
                ? out
                    ? `Абонемент «${s.plan.name}» израсходован. Оформите новый, чтобы продолжить ходить на ${vocabularyForWorkspaceType(s.workspace.type).session.nomPl}.`
                    : `На абонементе «${s.plan.name}» осталось последнее занятие.`
                : out
                  ? `Абонемент израсходован. Оформите новый, чтобы продолжить ходить на ${vocabularyForWorkspaceType(s.workspace.type).session.nomPl}.`
                  : 'На вашем абонементе осталось последнее занятие.'
            await this.notifications.notifyUser({
                userId,
                kind: out ? 'classes.exhausted' : 'classes.low',
                refId: `${s.id}:${s.classesRemaining}`,
                topic: out ? 'Занятия закончились' : 'Осталось 1 занятие',
                message,
                metadata: { subscriptionId: s.id },
                // Pack alerts ride the «Истечение доступа» preference.
                category: 'accessExpiringEnabled',
                workspaceId,
                feature: 'subscription',
            })
        }
    }
}
