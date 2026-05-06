import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    CreateVideoSubtitleFeature,
    VideoSubtitleResponse,
} from './create-video-subtitle.feature'

@Feature(CreateVideoSubtitleFeature)
export class CreateVideoSubtitleHandler
    implements
        IFeatureHandler<CreateVideoSubtitleFeature, VideoSubtitleResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload, workspaceId, videoId }: CreateVideoSubtitleFeature) {
        return await this.videoService.createSubtitle({
            workspaceId,
            videoId,
            language: payload.language,
            label: payload.label,
            storageKey: payload.storageKey,
            publicUrl: payload.publicUrl,
            isDefault: payload.isDefault,
        })
    }
}
