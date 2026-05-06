import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoService } from '../../domains/video/services/video.service'
import {
    CreateVideoSubtitleUploadFeature,
    CreateVideoSubtitleUploadFeatureResponse,
} from './create-video-subtitle-upload.feature'

@Feature(CreateVideoSubtitleUploadFeature)
export class CreateVideoSubtitleUploadHandler
    implements
        IFeatureHandler<
            CreateVideoSubtitleUploadFeature,
            CreateVideoSubtitleUploadFeatureResponse
        >
{
    constructor(private readonly videoService: VideoService) {}

    async execute({
        payload,
        workspaceId,
        videoId,
    }: CreateVideoSubtitleUploadFeature) {
        return await this.videoService.createSubtitleUpload({
            workspaceId,
            videoId,
            language: payload.language,
            contentType: payload.contentType,
        })
    }
}
