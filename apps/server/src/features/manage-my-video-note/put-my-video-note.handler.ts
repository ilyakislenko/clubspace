import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { loadVideoForStudent } from '../manage-my-video-bookmarks/schemas'
import {
    PutMyVideoNoteFeature,
    PutMyVideoNoteFeatureResponse,
} from './put-my-video-note.feature'
import { serializeMyVideoNote } from './schemas'

@Feature(PutMyVideoNoteFeature)
export class PutMyVideoNoteHandler
    implements
        IFeatureHandler<PutMyVideoNoteFeature, PutMyVideoNoteFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, videoId, payload }: PutMyVideoNoteFeature) {
        const { workspaceId } = await loadVideoForStudent(
            this.prisma,
            userId,
            videoId,
        )
        const where = { userId_videoId: { userId, videoId } }
        const updatedAt = new Date(payload.updatedAt)

        const existing = await this.prisma.videoNote.findUnique({ where })
        // Last-write-wins: a stale offline edit must not clobber a newer one.
        // A cleared note (text '') stays as a tombstone row for the same
        // reason — deleting it would let an older edit bring it back.
        if (existing && existing.updatedAt > updatedAt) {
            return serializeMyVideoNote(existing)
        }

        const row = await this.prisma.videoNote.upsert({
            where,
            create: { userId, videoId, workspaceId, text: payload.text, updatedAt },
            update: { text: payload.text, updatedAt },
        })
        return serializeMyVideoNote(row)
    }
}
