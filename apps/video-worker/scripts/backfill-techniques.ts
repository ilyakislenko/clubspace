// «Техники»: rebuilds the technique mentions of every ready video (or of
// --video <id>, repeatable / comma-separated) from its current chapters and
// transcript — what the `video-chapters` job does after each lesson. Cheap
// (no download, no model) and idempotent: run it after deploying, and again
// whenever the glossary (libs/sport-glossary) changes.

import { prisma } from '../src/clients.js'
import { videoIdsFrom } from '../src/script-args.js'
import { indexVideoTechniques } from '../src/technique-index.js'

const VIDEO_IDS = videoIdsFrom(process.argv)

async function main() {
    const videos = await prisma.video.findMany({
        where: { status: 'ready', ...(VIDEO_IDS.length > 0 && { id: { in: VIDEO_IDS } }) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true },
    })
    console.log(`[backfill-techniques] ${videos.length} ready video(s)`)
    let mentions = 0
    const failed: Array<{ id: string; title: string; error: string }> = []
    for (const video of videos) {
        try {
            const found = await indexVideoTechniques(prisma, video.id)
            mentions += found
            console.log(`[backfill-techniques] ${video.title}: ${found}`)
        } catch (error) {
            failed.push({
                id: video.id,
                title: video.title,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
    console.log(
        `[backfill-techniques] done: ${mentions} mention(s), ${failed.length} failed`,
    )
    for (const f of failed) console.error(`[backfill-techniques] ${f.id} ${f.title}: ${f.error}`)
    await prisma.$disconnect()
    if (failed.length > 0) process.exitCode = 1
}

main().catch(async (error) => {
    console.error('[backfill-techniques] failed', error)
    await prisma.$disconnect()
    process.exit(1)
})
