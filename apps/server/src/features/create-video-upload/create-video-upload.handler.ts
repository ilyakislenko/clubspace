import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import { TrialLimitsService } from '../../domains/billing/services/trial-limits.service'
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
        private readonly modules: ModuleEntitlementService,
        private readonly trialLimits: TrialLimitsService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: CreateVideoUploadFeature) {
        // No new uploads without the VIDEO module; what is already uploaded
        // stays manageable. Storage over the allowance is billed, not refused —
        // except during the trial, which has its own cap.
        await this.modules.assertEntitled(workspaceId, 'VIDEO')
        await this.trialLimits.assertCanUploadVideo(workspaceId, payload.sizeBytes)

        const result = await this.videoService.createUpload({
            ...payload,
            workspaceId,
        })

        await this.audit.record({
            action: 'video.startUpload',
            targetType: 'video',
            targetId: result.videoId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { title: payload.title },
        })

        return result
    }
}
