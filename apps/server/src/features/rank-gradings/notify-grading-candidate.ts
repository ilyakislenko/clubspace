import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { formatRuDate } from '../../shared/utils/format-ru-date'

// Tells a member they were put on a grading list. Best-effort and quiet under
// the same opt-outs as promotions; the caller sends it only to new candidates.
export const notifyGradingCandidate = async (
    notifications: NotificationProducerService,
    workspaceId: string,
    p: {
        gradingId: string
        ladderId: string
        userId: string
        date: Date
        levelName: string
        ladderName: string
    },
): Promise<void> => {
    await notifications.notifyUser({
        userId: p.userId,
        kind: 'grading.candidate',
        refId: `${p.gradingId}:${p.userId}`,
        topic: 'Аттестация',
        message: `Вы в списке на аттестацию ${formatRuDate(p.date, 'UTC')}: ${p.levelName} — ${p.ladderName}`,
        metadata: { gradingId: p.gradingId, ladderId: p.ladderId },
        category: 'promotionsEnabled',
        workspaceId,
        feature: 'ranks',
    })
}
