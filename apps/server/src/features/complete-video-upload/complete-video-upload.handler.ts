import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { VideoTranscodeProducer } from '../../domains/video/services/video-transcode.producer'
import { VideoService } from '../../domains/video/services/video.service'
import { PlanLimitReachedError } from '../../shared/errors/shared.errors'
import {
    CompleteVideoUploadFeature,
    CompleteVideoUploadFeatureResponse,
} from './complete-video-upload.feature'

@Feature(CompleteVideoUploadFeature)
export class CompleteVideoUploadHandler
    implements
        IFeatureHandler<
            CompleteVideoUploadFeature,
            CompleteVideoUploadFeatureResponse
        >
{
    constructor(
        private readonly videoService: VideoService,
        private readonly videoTranscodeProducer: VideoTranscodeProducer,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute({
        payload,
        videoId,
        invokerUserId,
    }: CompleteVideoUploadFeature) {
        // Room left on the plan, not counting this video (its size is only
        // recorded once it passes). Catches a client that declared no size or
        // a smaller one than it uploaded.
        const storage = await this.billing.remaining(
            payload.workspaceId,
            'storage',
        )
        await this.videoService.completeUpload({
            videoId,
            workspaceId: payload.workspaceId,
            quotaError: (sizeBytes) =>
                storage.remaining !== null && sizeBytes > storage.remaining
                    ? new PlanLimitReachedError({
                          limit: 'storage',
                          max: storage.max ?? 0,
                          used: storage.used,
                          planName: storage.planName,
                      })
                    : null,
        })

        await this.videoTranscodeProducer.enqueue(videoId)

        await this.audit.record({
            action: 'video.completeUpload',
            targetType: 'video',
            targetId: videoId,
            workspaceId: payload.workspaceId,
            actorId: invokerUserId,
        })

        return { status: 'queued' as const }
    }
}
