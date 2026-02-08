import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    CreateVideoThumbnailUploadFeature,
    CreateVideoThumbnailUploadFeatureResponse,
} from './create-video-thumbnail-upload.feature'

@Feature(CreateVideoThumbnailUploadFeature)
export class CreateVideoThumbnailUploadHandler
    implements
        IFeatureHandler<
            CreateVideoThumbnailUploadFeature,
            CreateVideoThumbnailUploadFeatureResponse
        >
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload, videoId }: CreateVideoThumbnailUploadFeature) {
        return await this.videoService.createThumbnailUpload({
            workspaceId: payload.workspaceId,
            videoId,
            contentType: payload.contentType,
        })
    }
}
