import { Logger } from '@nestjs/common'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'

// Tells the other side of a freeze request about a transition. refId is
// claimed forever by (kind, refId), so it carries the recipient. Best-effort:
// a failed push never fails the transition.
export const sendFreezeRequestNotice = async (
    notifications: NotificationProducerService,
    logger: Logger,
    p: {
        kind: string
        refBase: string
        recipients: string[]
        workspaceId: string
        freezeRequestId: string
        memberUserId: string
        topic: string
        message: string
    },
): Promise<void> => {
    for (const userId of p.recipients) {
        try {
            await notifications.notifyUser({
                userId,
                kind: p.kind,
                refId: `${p.refBase}:${userId}`,
                topic: p.topic,
                message: p.message,
                metadata: {
                    workspaceId: p.workspaceId,
                    freezeRequestId: p.freezeRequestId,
                    memberUserId: p.memberUserId,
                },
                workspaceId: p.workspaceId,
                feature: 'subscription',
            })
        } catch (err) {
            logger.warn(
                `Freeze request notification failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }
}
