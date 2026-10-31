import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { VideoService } from '../../domains/video/services/video.service'
import {
    CreateVideoUploadFeature,
    CreateVideoUploadFeatureResponse,
} from './create-video-upload.feature'

@Feature(CreateVideoUploadFeature)
export class CreateVideoUploadHandler
    implements
        IFeatureHandler<CreateVideoUploadFeature, CreateVideoUploadFeatureResponse>
{
    constructor(
        private readonly videoService: VideoService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute({ payload, invokerUserId }: CreateVideoUploadFeature) {
        // Refused before a row or a signed URL exists. The declared size is
        // checked here; complete-upload re-checks the measured one.
        await this.billing.assertWithinLimit(payload.workspaceId, 'videos')
        await this.billing.assertWithinLimit(
            payload.workspaceId,
            'storage',
            payload.sizeBytes ?? 1,
        )

        const result = await this.videoService.createUpload(payload)

        await this.audit.record({
            action: 'video.startUpload',
            targetType: 'video',
            targetId: result.videoId,
            workspaceId: payload.workspaceId,
            actorId: invokerUserId,
            metadata: { title: payload.title },
        })

        return result
    }
}
