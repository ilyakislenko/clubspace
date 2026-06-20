import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    GetOfflineDownloadFeature,
    GetOfflineDownloadFeatureResponse,
} from './get-offline-download.feature'

@Feature(GetOfflineDownloadFeature)
export class GetOfflineDownloadHandler
    implements
        IFeatureHandler<
            GetOfflineDownloadFeature,
            GetOfflineDownloadFeatureResponse
        >
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ videoId, userId }: GetOfflineDownloadFeature) {
        return await this.videoService.getOfflineDownload({ videoId, userId })
    }
}
