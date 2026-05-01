import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { VideoService } from '../../domains/video/services/video.service'
import { UpdateVideoFeature, UpdateVideoFeatureResponse } from './update-video.feature'

@Feature(UpdateVideoFeature)
export class UpdateVideoHandler
    implements IFeatureHandler<UpdateVideoFeature, UpdateVideoFeatureResponse>
{
    constructor(
        private readonly videoService: VideoService,
        private readonly audit: AuditService,
    ) {}

    async execute({ payload, videoId, invokerUserId }: UpdateVideoFeature) {
        const result = await this.videoService.updateVideo({
            workspaceId: payload.workspaceId,
            videoId,
            data: {
                title: payload.title,
                description: payload.description,
                thumbnailUrl: payload.thumbnailUrl,
                isPublic: payload.isPublic,
                tagIds: payload.tagIds,
                categoryIds: payload.categoryIds,
                playlistIds: payload.playlistIds,
                playlistId: payload.playlistId,
            },
        })

        await this.audit.record({
            action: 'video.update',
            targetType: 'video',
            targetId: videoId,
            workspaceId: payload.workspaceId,
            actorId: invokerUserId,
            metadata: {
                fields: Object.keys(payload).filter((key) => key !== 'workspaceId'),
            },
        })

        return result
    }
}
