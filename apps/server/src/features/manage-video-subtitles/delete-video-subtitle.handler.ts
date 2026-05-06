import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    DeleteVideoSubtitleFeature,
    DeleteVideoSubtitleFeatureResponse,
} from './delete-video-subtitle.feature'

@Feature(DeleteVideoSubtitleFeature)
export class DeleteVideoSubtitleHandler
    implements
        IFeatureHandler<
            DeleteVideoSubtitleFeature,
            DeleteVideoSubtitleFeatureResponse
        >
{
    constructor(private readonly videoService: VideoService) {}

    async execute({
        workspaceId,
        videoId,
        subtitleId,
    }: DeleteVideoSubtitleFeature) {
        return await this.videoService.deleteSubtitle({
            workspaceId,
            videoId,
            subtitleId,
        })
    }
}
