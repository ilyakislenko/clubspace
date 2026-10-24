import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'

@Injectable()
export class ClassPackNotifierService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    /**
     * After a check-in drew a class from these packs, tell each member whose
     * pack is now at 1 left or at 0. Deduped per (subscription, level).
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
                workspaceMember: { select: { userId: true } },
            },
        })
        for (const s of low) {
            const userId = s.workspaceMember?.userId
            if (!userId) continue
            const out = s.classesRemaining === 0
            await this.notifications.notifyUser({
                userId,
                kind: out ? 'classes.exhausted' : 'classes.low',
                refId: `${s.id}:${s.classesRemaining}`,
                topic: out ? 'Занятия закончились' : 'Осталось 1 занятие',
                message: out
                    ? 'Абонемент израсходован. Оформите новый, чтобы продолжить ходить на тренировки.'
                    : 'На вашем абонементе осталось последнее занятие.',
                metadata: { subscriptionId: s.id },
                // Pack alerts ride the «Истечение доступа» preference.
                category: 'accessExpiringEnabled',
                workspaceId,
                feature: 'subscription',
            })
        }
    }
}
