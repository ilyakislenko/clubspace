import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { VideoService } from '../../domains/video/services/video.service'
import {
    DeleteVideoFeature,
    DeleteVideoFeatureResponse,
} from './delete-video.feature'

@Feature(DeleteVideoFeature)
export class DeleteVideoHandler
    implements IFeatureHandler<DeleteVideoFeature, DeleteVideoFeatureResponse>
{
    constructor(
        private readonly videoService: VideoService,
        private readonly audit: AuditService,
    ) {}

    async execute({ workspaceId, videoId, invokerUserId }: DeleteVideoFeature) {
        const result = await this.videoService.deleteVideo({
            videoId,
            workspaceId,
        })

        await this.audit.record({
            action: 'video.delete',
            targetType: 'video',
            targetId: videoId,
            workspaceId,
            actorId: invokerUserId,
        })

        return result
    }
}
