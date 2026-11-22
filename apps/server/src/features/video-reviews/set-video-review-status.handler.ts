import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadReviewForViewer, reviewSummaryInclude, serializeReviewSummary } from './schemas'
import {
    SetVideoReviewStatusFeature,
    SetVideoReviewStatusFeatureResponse,
} from './set-video-review-status.feature'
import { notifyMemberAnswered } from './video-review-notifications'
import { canSetStatus } from './video-reviews-utils'

@Feature(SetVideoReviewStatusFeature)
export class SetVideoReviewStatusHandler
    implements
        IFeatureHandler<SetVideoReviewStatusFeature, SetVideoReviewStatusFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
        private readonly notifications: NotificationProducerService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(
        f: SetVideoReviewStatusFeature,
    ): Promise<SetVideoReviewStatusFeatureResponse> {
        const { request, isStaff } = await loadReviewForViewer(this.prisma, this.rbac, f)
        const next = f.payload.status
        if (!canSetStatus(isStaff ? 'staff' : 'owner', next)) {
            throw new ForbiddenError({ message: 'Отметить разбор отвеченным может только тренер' })
        }
        if (request.clip.status !== 'ready') {
            throw new BadRequestError({ message: 'Видео ещё не готово' })
        }
        if (request.status === next) {
            return await serializeReviewSummary(this.files, request)
        }
        const updated = await this.prisma.videoReviewRequest.update({
            where: { id: request.id },
            data: { status: next },
            include: reviewSummaryInclude,
        })
        // Open ↔ answered/closed: staff «Заявки» update live.
        this.realtime.invalidate(f.workspaceId, ['requests'])
        if (next === 'answered' && request.memberUserId !== f.userId) {
            await notifyMemberAnswered(this.notifications, this.prisma, {
                workspaceId: f.workspaceId,
                requestId: request.id,
                memberUserId: request.memberUserId,
                title: request.title,
                answeredAt: updated.updatedAt,
            })
        }
        return await serializeReviewSummary(this.files, updated)
    }
}
