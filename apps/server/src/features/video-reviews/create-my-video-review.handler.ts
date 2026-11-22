import { randomUUID } from 'crypto'

import { Feature, IFeatureHandler } from '@shelfjs/features'

import { tooLargeMessage } from '../../domains/video/services/video.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    CreateMyVideoReviewFeature,
    CreateMyVideoReviewFeatureResponse,
} from './create-my-video-review.feature'
import { reviewSummaryInclude, serializeReviewSummary } from './schemas'
import { MAX_REVIEW_CLIP_BYTES, reviewClipKeys } from './video-reviews-utils'

// Requests a member may have waiting (not closed) at once.
export const MAX_ACTIVE_REVIEWS = 10

@Feature(CreateMyVideoReviewFeature)
export class CreateMyVideoReviewHandler
    implements
        IFeatureHandler<CreateMyVideoReviewFeature, CreateMyVideoReviewFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute({
        userId,
        workspaceId,
        payload,
    }: CreateMyVideoReviewFeature): Promise<CreateMyVideoReviewFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)

        const maxBytes = Math.min(MAX_REVIEW_CLIP_BYTES, this.files.getMaxVideoUploadBytes())
        if (payload.sizeBytes > maxBytes) {
            throw new BadRequestError({ message: tooLargeMessage(maxBytes) })
        }
        const active = await this.prisma.videoReviewRequest.count({
            where: { memberUserId: userId, workspaceId, status: { not: 'closed' } },
        })
        if (active >= MAX_ACTIVE_REVIEWS) {
            throw new BadRequestError({
                message: `Не больше ${MAX_ACTIVE_REVIEWS} разборов одновременно — закройте или удалите старые`,
            })
        }

        const clipId = randomUUID()
        const bucket = this.files.getDefaultBucketName()
        const { rawKey } = reviewClipKeys(clipId)
        const [, request] = await this.prisma.$transaction([
            this.prisma.reviewClip.create({
                data: {
                    id: clipId,
                    workspaceId,
                    ownerUserId: userId,
                    status: 'uploading',
                    rawBucket: bucket,
                    rawKey,
                    hlsBucket: bucket,
                },
            }),
            this.prisma.videoReviewRequest.create({
                data: {
                    workspaceId,
                    clipId,
                    memberUserId: userId,
                    title: payload.title,
                    message: payload.message || null,
                },
                include: reviewSummaryInclude,
            }),
        ])

        const upload = await this.files.getPresignedPutUrl({
            bucket,
            key: rawKey,
            contentType: payload.contentType,
            contentLength: payload.sizeBytes,
        })
        return {
            request: await serializeReviewSummary(this.files, request),
            upload,
        }
    }
}
