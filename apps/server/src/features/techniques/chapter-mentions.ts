import { Logger } from '@nestjs/common'

import { extractTechniqueMentions, type SportType } from '@clubspace/sport-glossary'

import type { PrismaService } from '../../infrastructure/prisma'

const logger = new Logger('ChapterTechniqueMentions')

/**
 * «Техники»: a coach added, renamed, moved or removed a chapter — redo the
 * lesson's chapter mentions (its speech mentions stay; the worker owns
 * those). Best effort: the chapter edit itself has already succeeded, and the
 * backfill script rebuilds everything, so a failure is only logged.
 */
export async function reindexChapterMentions(
    prisma: PrismaService,
    videoId: string,
): Promise<void> {
    try {
        const video = await prisma.video.findUnique({
            where: { id: videoId },
            select: {
                workspaceId: true,
                workspace: { select: { type: true } },
                timestamps: { select: { positionSec: true, title: true } },
            },
        })
        if (!video) return
        const mentions = extractTechniqueMentions({
            sport: video.workspace.type as SportType,
            chapters: video.timestamps,
        })
        await prisma.$transaction([
            prisma.videoTechniqueMention.deleteMany({ where: { videoId, kind: 'chapter' } }),
            prisma.videoTechniqueMention.createMany({
                data: mentions.map((m) => ({
                    videoId,
                    workspaceId: video.workspaceId,
                    technique: m.technique,
                    kind: m.kind,
                    atSec: m.atSec,
                    text: m.text,
                    matched: m.matched.slice(0, 200),
                })),
            }),
        ])
    } catch (err) {
        logger.error(`could not reindex chapter techniques of ${videoId}: ${String(err)}`)
    }
}
