import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
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
    ) {}

    async execute({ payload, invokerUserId }: CreateVideoUploadFeature) {
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
