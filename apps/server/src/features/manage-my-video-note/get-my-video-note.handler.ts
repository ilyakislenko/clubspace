import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { loadVideoForStudent } from '../manage-my-video-bookmarks/schemas'
import {
    GetMyVideoNoteFeature,
    GetMyVideoNoteFeatureResponse,
} from './get-my-video-note.feature'
import { serializeMyVideoNote } from './schemas'

@Feature(GetMyVideoNoteFeature)
export class GetMyVideoNoteHandler
    implements
        IFeatureHandler<GetMyVideoNoteFeature, GetMyVideoNoteFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, videoId }: GetMyVideoNoteFeature) {
        await loadVideoForStudent(this.prisma, userId, videoId)
        const row = await this.prisma.videoNote.findUnique({
            where: { userId_videoId: { userId, videoId } },
        })
        return serializeMyVideoNote(row)
    }
}
