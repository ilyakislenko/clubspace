import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    SaveVideoProgressFeature,
    SaveVideoProgressFeatureResponse,
} from './save-video-progress.feature'

const COMPLETION_RATIO = 0.9

@Feature(SaveVideoProgressFeature)
export class SaveVideoProgressHandler
    implements
        IFeatureHandler<
            SaveVideoProgressFeature,
            SaveVideoProgressFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({
        userId,
        videoId,
        payload,
    }: SaveVideoProgressFeature) {
        const video = await this.prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, workspaceId: true, duration: true },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Видео не найдено' })
        }

        // Same gate as playback: without it any authenticated user could
        // write progress for a video in any workspace (and back-fill its
        // duration) just by id, and a student could "complete" a lesson they
        // can't open to unlock the next one under locked progression.
        const access = await this.courseAccess.assertCanWatchVideo(
            video,
            userId,
        )

        const position = Math.max(0, payload.position ?? 0)

        // Back-fill Video.duration when the player reports it and the row
        // is empty. Old uploads have null duration which breaks the auto-
        // complete check below; once a single client posts the real value
        // every subsequent watcher gets correct progress.
        const reportedDuration =
            payload.duration && payload.duration > 0
                ? Math.round(payload.duration)
                : null
        let effectiveDuration = video.duration ?? null
        if (reportedDuration && !effectiveDuration) {
            await this.prisma.video.update({
                where: { id: videoId },
                data: { duration: reportedDuration },
            })
            effectiveDuration = reportedDuration
        } else if (reportedDuration) {
            // Trust the more recent player reading even if DB had a value —
            // it tends to be accurate for HLS where ffprobe sometimes lies.
            effectiveDuration = reportedDuration
        }

        const autoCompleted =
            !!effectiveDuration &&
            effectiveDuration > 0 &&
            position / effectiveDuration >= COMPLETION_RATIO

        // In a locked-progression course a lesson counts as passed only once
        // it was really watched to 90%: a student's explicit "mark watched"
        // falls back to the position reading there, so the button can't skip
        // the sequence. Un-marking (false) and staff are untouched.
        let explicitCompleted = payload.completed
        if (explicitCompleted === true && !autoCompleted && !access.isStaff) {
            const sequential = await this.prisma.courseVideo.findFirst({
                where: { videoId, course: { lockedProgression: true } },
                select: { courseId: true },
            })
            if (sequential) explicitCompleted = undefined
        }
        const completed = explicitCompleted ?? autoCompleted

        const now = new Date()

        const record = await this.prisma.videoWatched.upsert({
            where: { userId_videoId: { userId, videoId } },
            create: {
                userId,
                videoId,
                workspaceId: video.workspaceId,
                position,
                completed,
                watchedAt: now,
            },
            update: {
                position,
                watchedAt: now,
                // Don't let an auto (position-based) reading downgrade a video
                // that was already marked completed — e.g. scrubbing back to the
                // start shouldn't un-complete it. Only an EXPLICIT completed flag
                // (the mark/un-mark toggle) changes the stored value.
                ...(explicitCompleted !== undefined
                    ? { completed: explicitCompleted }
                    : autoCompleted
                      ? { completed: true }
                      : {}),
            },
        })

        return {
            videoId,
            position: record.position,
            completed: record.completed,
            watchedAt: record.watchedAt.toISOString(),
        }
    }
}
