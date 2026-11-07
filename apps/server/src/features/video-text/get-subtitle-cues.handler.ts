import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { isSubtitleKey } from '../../shared/utils/storage-keys'
import {
    GetSubtitleCuesFeature,
    type GetSubtitleCuesFeatureResponse,
    SUBTITLE_PREVIEW_CUES,
} from './video-text.feature'
import { parseVttCues } from './vtt-cues'

/** A subtitle track's cues, read from storage, for staff's preview. */
@Feature(GetSubtitleCuesFeature)
export class GetSubtitleCuesHandler
    implements IFeatureHandler<GetSubtitleCuesFeature, GetSubtitleCuesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute({ workspaceId, videoId, subtitleId }: GetSubtitleCuesFeature) {
        const subtitle = await this.prisma.videoSubtitle.findFirst({
            where: { id: subtitleId, videoId, video: { workspaceId } },
            select: { storageKey: true },
        })
        if (!subtitle || !isSubtitleKey(subtitle.storageKey, videoId)) {
            throw new NotFoundError({ message: 'Субтитры не найдены' })
        }
        const cues = parseVttCues(
            await this.files.getObjectText({
                bucket: this.files.getDefaultBucketName(),
                key: subtitle.storageKey,
            }),
        )
        return { cues: cues.slice(0, SUBTITLE_PREVIEW_CUES), total: cues.length }
    }
}
