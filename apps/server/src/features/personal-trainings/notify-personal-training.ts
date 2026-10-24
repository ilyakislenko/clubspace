import { Logger } from '@nestjs/common'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { displayName } from '../attendance/schemas'

type Person = {
    firstname: string | null
    lastname: string | null
    email: string
}

// The other participant, from `userId`'s point of view.
export const counterpartName = (
    r: { memberId: string; member: Person; coach: Person },
    userId: string,
): string =>
    displayName(userId === r.memberId ? r.coach : r.member)

// Tells the other side of a personal-training request about a transition.
// refId is claimed forever by (kind, refId), so it carries the recipient and a
// per-transition base — a second coach or a re-proposal is never swallowed.
// Best-effort: a failed push never fails the transition.
export const sendPersonalTrainingNotice = async (
    notifications: NotificationProducerService,
    logger: Logger,
    p: {
        kind: string
        refBase: string
        recipients: string[]
        workspaceId: string
        requestId: string
        topic: (userId: string) => string
        message: (userId: string) => string
    },
): Promise<void> => {
    for (const userId of p.recipients) {
        try {
            await notifications.notifyUser({
                userId,
                kind: p.kind,
                refId: `${p.refBase}:${userId}`,
                topic: p.topic(userId),
                message: p.message(userId),
                metadata: { requestId: p.requestId },
                workspaceId: p.workspaceId,
            })
        } catch (err) {
            logger.warn(
                `Personal training notification failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }
}
