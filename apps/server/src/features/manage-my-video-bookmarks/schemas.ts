import { z } from 'zod'

import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { BookmarkDrawingSchema, parseStoredDrawing } from './drawing'

export const MyVideoBookmarkSchema = z.object({
    id: z.string().uuid(),
    videoId: z.string().uuid(),
    positionSec: z.number().int(),
    // Non-null = a saved A–B segment.
    endSec: z.number().int().nullable(),
    label: z.string(),
    note: z.string(),
    // A sketch over the paused frame at `positionSec`; null = none.
    drawing: BookmarkDrawingSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // Tombstone (deleted on some device); only PUT ever returns one.
    deleted: z.boolean(),
})

export type MyVideoBookmark = z.infer<typeof MyVideoBookmarkSchema>

export const serializeMyVideoBookmark = (row: {
    id: string
    videoId: string
    positionSec: number
    endSec: number | null
    label: string
    note: string
    drawing: unknown
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}): MyVideoBookmark => ({
    id: row.id,
    videoId: row.videoId,
    positionSec: row.positionSec,
    endSec: row.endSec,
    label: row.label,
    note: row.note,
    drawing: parseStoredDrawing(row.drawing),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deleted: row.deletedAt !== null,
})

/**
 * Personal study data (bookmarks, notes) hangs off a bare video id, so —
 * like favorites — gate on membership of the video's workspace to stop a
 * user writing to (or probing) another club's videos. Returns the
 * workspace the rows must be stamped with.
 */
export async function loadVideoForStudent(
    prisma: PrismaService,
    userId: string,
    videoId: string,
): Promise<{ workspaceId: string }> {
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true, workspaceId: true },
    })
    if (!video) {
        throw new NotFoundError({ message: 'Видео не найдено' })
    }
    await assertActiveWorkspaceMembership(prisma, userId, video.workspaceId)
    return { workspaceId: video.workspaceId }
}
