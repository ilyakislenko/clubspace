import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    GetVideoReviewFeature,
    GetVideoReviewFeatureResponse,
} from './get-video-review.feature'
import { loadReviewForViewer, serializeReviewDetail } from './schemas'

@Feature(GetVideoReviewFeature)
export class GetVideoReviewHandler
    implements IFeatureHandler<GetVideoReviewFeature, GetVideoReviewFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(f: GetVideoReviewFeature): Promise<GetVideoReviewFeatureResponse> {
        const loaded = await loadReviewForViewer(this.prisma, f)
        return await serializeReviewDetail(this.prisma, this.files, loaded, f.userId)
    }
}
