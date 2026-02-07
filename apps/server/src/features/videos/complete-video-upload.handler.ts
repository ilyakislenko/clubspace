import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoTranscodeProducer } from '../../domains/video/services/video-transcode.producer'
import { VideoService } from '../../domains/video/services/video.service'
import {
    CompleteVideoUploadFeature,
    CompleteVideoUploadFeatureResponse,
} from './complete-video-upload.feature'

@Feature(CompleteVideoUploadFeature)
export class CompleteVideoUploadHandler
    implements
        IFeatureHandler<
            CompleteVideoUploadFeature,
            CompleteVideoUploadFeatureResponse
        >
{
    constructor(
        private readonly videoService: VideoService,
        private readonly videoTranscodeProducer: VideoTranscodeProducer,
    ) {}

    async execute({ payload, videoId }: CompleteVideoUploadFeature) {
        await this.videoService.completeUpload({
            videoId,
            workspaceId: payload.workspaceId,
        })

        await this.videoTranscodeProducer.enqueue(videoId)

        return { status: 'queued' as const }
    }
}
