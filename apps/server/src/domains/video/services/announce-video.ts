import { PrismaService } from '../../../infrastructure/prisma'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'

/**
 * Notify workspace members once — ever — when a READY video first becomes
 * visible to them, i.e. it sits in at least one published course
 * (publishedAt <= now). Deep-links to the video; respects the per-user
 * `newVideosEnabled` opt-out; the author is excluded.
 *
 * State-based and claim-guarded on the videoId (see notifyWorkspace), so it's
 * safe — and correct — to call from every point a video can become live:
 * attaching it to a course, editing its course membership, or its transcode
 * finishing. Only the first call that finds it live actually notifies.
 *
 * NB: publishing a whole course is deliberately NOT a caller — that path sends
 * one course-level "new course" push (see update-playlist), so a fresh course's
 * initial videos don't each fire a separate alert.
 */
export const announceVideoIfLive = async (
    prisma: PrismaService,
    notifications: NotificationProducerService,
    args: { workspaceId: string; videoId: string; actorId?: string },
): Promise<void> => {
    const video = await prisma.video.findFirst({
        where: { id: args.videoId, workspaceId: args.workspaceId },
        select: { title: true, status: true },
    })
    // Not transcoded yet → not watchable. A later video-ready call retries.
    if (!video || video.status !== 'ready') return

    const liveCourse = await prisma.courseVideo.findFirst({
        where: {
            videoId: args.videoId,
            course: { publishedAt: { lte: new Date() } },
        },
        select: { courseId: true },
    })
    if (!liveCourse) return

    await notifications.notifyWorkspace({
        workspaceId: args.workspaceId,
        kind: 'video.published',
        refId: args.videoId,
        topic: 'Новое видео',
        message: video.title,
        metadata: { videoId: args.videoId },
        excludeUserId: args.actorId,
        category: 'newVideosEnabled',
    })
}
