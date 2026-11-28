import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { VideoService } from '../../domains/video/services/video.service'
import {
    AbortVideoUploadFeature,
    AbortVideoUploadFeatureResponse,
} from './abort-video-upload.feature'

// The client cancelled an upload, or it failed before transcoding: drop the
// parts already in storage and the video row. Same access as starting and
// completing an upload (COACHING_ROLES on the route) and, unlike starting
// one, no VIDEO module check — cancelling must always work.
@Feature(AbortVideoUploadFeature)
export class AbortVideoUploadHandler
    implements
        IFeatureHandler<AbortVideoUploadFeature, AbortVideoUploadFeatureResponse>
{
    constructor(
        private readonly videoService: VideoService,
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        videoId,
        invokerUserId,
    }: AbortVideoUploadFeature) {
        const result = await this.videoService.abortUpload({ videoId, workspaceId })

        await this.audit.record({
            action: 'video.abortUpload',
            targetType: 'video',
            targetId: videoId,
            workspaceId,
            actorId: invokerUserId,
        })

        return result
    }
}
