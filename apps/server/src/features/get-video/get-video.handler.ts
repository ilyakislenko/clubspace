import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import { GetVideoFeature, GetVideoFeatureResponse } from './get-video.feature'

@Feature(GetVideoFeature)
export class GetVideoHandler
    implements IFeatureHandler<GetVideoFeature, GetVideoFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload, videoId }: GetVideoFeature) {
        return await this.videoService.getVideo({
            videoId,
            workspaceId: payload.workspaceId,
        })
    }
}
