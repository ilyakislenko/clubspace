import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    GetVideoPlaybackFeature,
    GetVideoPlaybackFeatureResponse,
} from './get-video-playback.feature'

@Feature(GetVideoPlaybackFeature)
export class GetVideoPlaybackHandler
    implements
        IFeatureHandler<GetVideoPlaybackFeature, GetVideoPlaybackFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ videoId, userId }: GetVideoPlaybackFeature) {
        return await this.videoService.getPlaybackUrl({ videoId, userId })
    }
}
