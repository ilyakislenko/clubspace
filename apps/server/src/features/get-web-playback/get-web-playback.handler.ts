import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    GetWebPlaybackFeature,
    GetWebPlaybackFeatureResponse,
} from './get-web-playback.feature'

@Feature(GetWebPlaybackFeature)
export class GetWebPlaybackHandler
    implements
        IFeatureHandler<GetWebPlaybackFeature, GetWebPlaybackFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ videoId, userId }: GetWebPlaybackFeature) {
        return await this.videoService.getWebPlayback({ videoId, userId })
    }
}
