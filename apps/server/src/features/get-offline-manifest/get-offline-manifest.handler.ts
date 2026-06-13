import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    GetOfflineManifestFeature,
    GetOfflineManifestFeatureResponse,
} from './get-offline-manifest.feature'

@Feature(GetOfflineManifestFeature)
export class GetOfflineManifestHandler
    implements
        IFeatureHandler<
            GetOfflineManifestFeature,
            GetOfflineManifestFeatureResponse
        >
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ videoId, userId }: GetOfflineManifestFeature) {
        return await this.videoService.getOfflineManifest({ videoId, userId })
    }
}
