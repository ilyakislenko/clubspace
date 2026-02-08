import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import { UpdateVideoFeature, UpdateVideoFeatureResponse } from './update-video.feature'

@Feature(UpdateVideoFeature)
export class UpdateVideoHandler
    implements IFeatureHandler<UpdateVideoFeature, UpdateVideoFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload, videoId }: UpdateVideoFeature) {
        return await this.videoService.updateVideo({
            workspaceId: payload.workspaceId,
            videoId,
            data: {
                title: payload.title,
                description: payload.description,
                thumbnailUrl: payload.thumbnailUrl,
                tagIds: payload.tagIds,
                categoryIds: payload.categoryIds,
                playlistId: payload.playlistId,
            },
        })
    }
}
