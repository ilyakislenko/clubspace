import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    CreateVideoUploadFeature,
    CreateVideoUploadFeatureResponse,
} from './create-video-upload.feature'

@Feature(CreateVideoUploadFeature)
export class CreateVideoUploadHandler
    implements
        IFeatureHandler<CreateVideoUploadFeature, CreateVideoUploadFeatureResponse>
{
    constructor(private readonly videoService: VideoService) {}

    async execute({ payload }: CreateVideoUploadFeature) {
        return await this.videoService.createUpload(payload)
    }
}
