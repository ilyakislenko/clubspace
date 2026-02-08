import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import { ListVideosFeature, ListVideosFeatureResponse } from './list-videos.feature'

@Feature(ListVideosFeature)
export class ListVideosHandler
    implements IFeatureHandler<ListVideosFeature, ListVideosFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload }: ListVideosFeature) {
        return await this.videoService.listVideos({
            workspaceId: payload.workspaceId,
            curPage: payload.curPage,
            perPage: payload.perPage,
        })
    }
}
