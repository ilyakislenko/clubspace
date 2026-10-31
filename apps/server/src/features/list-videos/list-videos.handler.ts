import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import { ListVideosFeature, ListVideosFeatureResponse } from './list-videos.feature'

@Feature(ListVideosFeature)
export class ListVideosHandler
    implements IFeatureHandler<ListVideosFeature, ListVideosFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload, workspaceId }: ListVideosFeature) {
        return await this.videoService.listVideos({
            workspaceId,
            curPage: payload.curPage,
            perPage: payload.perPage,
            q: payload.q,
            tagId: payload.tagId,
            categoryId: payload.categoryId,
        })
    }
}
