import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { issuePlaybackToken } from '../../shared/utils/playback-token.util'
import {
    GetVideoReviewPlaybackFeature,
    GetVideoReviewPlaybackFeatureResponse,
} from './get-video-review-playback.feature'
import { loadReviewForViewer } from './schemas'
import { reviewClipTokenSubject } from './video-reviews-utils'

@Feature(GetVideoReviewPlaybackFeature)
export class GetVideoReviewPlaybackHandler
    implements
        IFeatureHandler<GetVideoReviewPlaybackFeature, GetVideoReviewPlaybackFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(
        f: GetVideoReviewPlaybackFeature,
    ): Promise<GetVideoReviewPlaybackFeatureResponse> {
        const { request } = await loadReviewForViewer(this.prisma, f)
        const { clip } = request
        if (clip.status !== 'ready' || !clip.hlsMasterKey) {
            throw new BadRequestError({ message: 'Видео ещё обрабатывается' })
        }
        const token = issuePlaybackToken({
            videoId: reviewClipTokenSubject(clip.id),
            userId: f.userId,
        })
        const base = environment.rootUrl.replace(/\/$/, '')
        return {
            hlsUrl: `${base}/review-clips/${clip.id}/manifest.m3u8?token=${encodeURIComponent(token)}`,
        }
    }
}
