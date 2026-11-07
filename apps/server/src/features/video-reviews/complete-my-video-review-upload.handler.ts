import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { VideoTranscodeProducer } from '../../domains/video/services/video-transcode.producer'
import { tooLargeMessage } from '../../domains/video/services/video.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    CompleteMyVideoReviewUploadFeature,
    CompleteMyVideoReviewUploadFeatureResponse,
} from './complete-my-video-review-upload.feature'
import { loadOwnReview } from './my-video-review-access'
import { person, serializeReviewSummary } from './schemas'
import { notifyCoachesOfReview } from './video-review-notifications'
import { MAX_REVIEW_CLIP_BYTES } from './video-reviews-utils'

@Feature(CompleteMyVideoReviewUploadFeature)
export class CompleteMyVideoReviewUploadHandler
    implements
        IFeatureHandler<
            CompleteMyVideoReviewUploadFeature,
            CompleteMyVideoReviewUploadFeatureResponse
        >
{
    private readonly logger = new Logger(CompleteMyVideoReviewUploadHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
        private readonly transcode: VideoTranscodeProducer,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(
        f: CompleteMyVideoReviewUploadFeature,
    ): Promise<CompleteMyVideoReviewUploadFeatureResponse> {
        const request = await loadOwnReview(this.prisma, f)
        const { clip } = request
        // A retried «complete» after the first one went through: nothing to do.
        if (clip.status !== 'uploading') {
            return await serializeReviewSummary(this.files, request)
        }

        const size = await this.files.getObjectSize({ bucket: clip.rawBucket, key: clip.rawKey })
        if (size === null) {
            throw new BadRequestError({ message: 'Загруженный файл не найден' })
        }
        const maxBytes = Math.min(MAX_REVIEW_CLIP_BYTES, this.files.getMaxVideoUploadBytes())
        if (size > maxBytes) {
            // Fail the clip first, so a delete that errors can't leave it
            // stuck in «uploading».
            const message = tooLargeMessage(maxBytes)
            await this.prisma.reviewClip.update({
                where: { id: clip.id },
                data: { status: 'failed', errorMessage: message },
            })
            await this.files
                .deleteObject({ bucket: clip.rawBucket, key: clip.rawKey })
                .catch((err: unknown) =>
                    this.logger.error(`could not delete rejected clip ${clip.id}: ${String(err)}`),
                )
            throw new BadRequestError({ message })
        }

        await this.prisma.reviewClip.update({
            where: { id: clip.id },
            data: { status: 'uploaded', sizeBytes: BigInt(size) },
        })
        await this.transcode.enqueueReviewClip(clip.id)
        await notifyCoachesOfReview(this.notifications, this.prisma, {
            workspaceId: f.workspaceId,
            requestId: request.id,
            memberUserId: f.userId,
            memberName: person(request.member).name,
            title: request.title,
        })
        return await serializeReviewSummary(this.files, {
            ...request,
            clip: { ...clip, status: 'uploaded' },
        })
    }
}
