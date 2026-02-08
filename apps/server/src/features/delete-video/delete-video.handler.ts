import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    DeleteVideoFeature,
    DeleteVideoFeatureResponse,
} from './delete-video.feature'

@Feature(DeleteVideoFeature)
export class DeleteVideoHandler
    implements IFeatureHandler<DeleteVideoFeature, DeleteVideoFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload, videoId }: DeleteVideoFeature) {
        return await this.videoService.deleteVideo({
            videoId,
            workspaceId: payload.workspaceId,
        })
    }
}
