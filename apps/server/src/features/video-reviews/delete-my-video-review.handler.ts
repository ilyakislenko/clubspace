import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    DeleteMyVideoReviewFeature,
    DeleteMyVideoReviewFeatureResponse,
} from './delete-my-video-review.feature'
import { loadOwnReview } from './my-video-review-access'
import { deleteReviewClipFiles } from './review-clip-storage'

@Feature(DeleteMyVideoReviewFeature)
export class DeleteMyVideoReviewHandler
    implements IFeatureHandler<DeleteMyVideoReviewFeature, DeleteMyVideoReviewFeatureResponse>
{
    private readonly logger = new Logger(DeleteMyVideoReviewHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeleteMyVideoReviewFeature): Promise<DeleteMyVideoReviewFeatureResponse> {
        const request = await loadOwnReview(this.prisma, f)
        await deleteReviewClipFiles(this.files, [request.clip], (m) => this.logger.error(m))
        // The request and its comments go with the clip (FK cascade).
        await this.prisma.reviewClip.delete({ where: { id: request.clip.id } })
        this.realtime.invalidate(f.workspaceId, ['requests'])
        return { status: 'deleted' }
    }
}
