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

// Tells the PENDING candidates a grading moved to another day. The row's
// updatedAt is in the refId, so each move is its own notice (also a move back
// to a date used before); the caller only calls it when the date really changed.
export const notifyGradingMoved = async (
    notifications: NotificationProducerService,
    workspaceId: string,
    p: {
        gradingId: string
        userId: string
        title: string
        date: Date
        updatedAt: Date
    },
): Promise<void> => {
    await notifications.notifyUser({
        userId: p.userId,
        kind: 'grading.moved',
        refId: `${p.gradingId}:${p.userId}:${p.updatedAt.toISOString()}`,
        topic: 'Аттестация',
        message: `Аттестация «${p.title}» перенесена на ${formatRuDate(p.date, 'UTC')}`,
        metadata: { gradingId: p.gradingId },
        category: 'promotionsEnabled',
        workspaceId,
        feature: 'ranks',
    })
}

// Tells the PENDING candidates a grading was cancelled.
export const notifyGradingCancelled = async (
    notifications: NotificationProducerService,
    workspaceId: string,
    p: { gradingId: string; userId: string; title: string },
): Promise<void> => {
    await notifications.notifyUser({
        userId: p.userId,
        kind: 'grading.cancelled',
        refId: `${p.gradingId}:${p.userId}:cancelled`,
        topic: 'Аттестация',
        message: `Аттестация «${p.title}» отменена`,
        metadata: { gradingId: p.gradingId },
        category: 'promotionsEnabled',
        workspaceId,
        feature: 'ranks',
    })
}
