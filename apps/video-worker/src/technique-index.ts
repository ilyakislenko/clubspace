import type { PrismaClient } from '@clubspace/prisma-client'
import { extractTechniqueMentions, type SportType } from '@clubspace/sport-glossary'

// «Техники»: after a lesson's chapters and transcript are made (the
// `video-chapters` job), its technique mentions are rebuilt from scratch —
// chapter titles, what is said and its Russian translation (see
// libs/sport-glossary/src/techniques.ts). Idempotent; the backfill script
// runs the same for every ready video.

export type TechniqueIndexDb = Pick<
    PrismaClient,
    'video' | 'videoTechniqueMention' | '$transaction'
>

// The Russian translation's cues: translations = { ru: [{from, to, text}] }.
const russianCues = (translations: unknown): unknown =>
    typeof translations === 'object' && translations !== null && 'ru' in translations
        ? translations.ru
        : null

/** Rebuilds the lesson's technique mentions; returns how many it found. */
export async function indexVideoTechniques(
    db: TechniqueIndexDb,
    videoId: string,
): Promise<number> {
    const video = await db.video.findUnique({
        where: { id: videoId },
        select: {
            workspaceId: true,
            workspace: { select: { type: true } },
            timestamps: { select: { positionSec: true, title: true } },
            transcript: { select: { segments: true, translations: true } },
        },
    })
    if (!video) return 0
    const mentions = extractTechniqueMentions({
        sport: video.workspace.type as SportType,
        chapters: video.timestamps,
        segments: video.transcript?.segments,
        ruSegments: russianCues(video.transcript?.translations),
    })
    await db.$transaction([
        db.videoTechniqueMention.deleteMany({ where: { videoId } }),
        db.videoTechniqueMention.createMany({
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
    return mentions.length
}
