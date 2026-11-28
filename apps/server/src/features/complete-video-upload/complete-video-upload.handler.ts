import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
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
        private readonly audit: AuditService,
    ) {}

    async execute({
        workspaceId,
        videoId,
        invokerUserId,
        parts,
    }: CompleteVideoUploadFeature) {
        // A multipart upload is assembled from its parts first; the real size
        // is then measured either way.
        await this.videoService.completeUpload({ videoId, workspaceId, parts })

        await this.videoTranscodeProducer.enqueue(videoId)

        await this.audit.record({
            action: 'video.completeUpload',
            targetType: 'video',
            targetId: videoId,
            workspaceId,
            actorId: invokerUserId,
        })

        return { status: 'queued' as const }
    }
}
