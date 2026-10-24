import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'

// Congratulates a member on a new rank. Shared by the single and the bulk
// promote paths so both send the same message under the same opt-outs.
export const notifyPromotion = async (
    notifications: NotificationProducerService,
    workspaceId: string,
    promotion: {
        id: string
        userId: string
        ladderId: string
        levelId: string
        stripes: number
        level: { name: string }
        ladder: { name: string }
    },
): Promise<void> => {
    const stripeSuffix = promotion.stripes ? ` (${promotion.stripes}★)` : ''
    await notifications.notifyUser({
        userId: promotion.userId,
        kind: 'rank.promoted',
        refId: promotion.id,
        topic: 'Новый ранг',
        message: `Поздравляем! Вам присвоен ранг: ${promotion.level.name}${stripeSuffix} — ${promotion.ladder.name}`,
        metadata: {
            promotionId: promotion.id,
            ladderId: promotion.ladderId,
            levelId: promotion.levelId,
        },
        category: 'promotionsEnabled',
        // Skip if the club hid the Ranks section from the app.
        workspaceId,
        feature: 'ranks',
    })
}
