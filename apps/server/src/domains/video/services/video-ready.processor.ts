import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job } from 'bullmq'

import { PrismaService } from '../../../infrastructure/prisma'
import { NotificationsService } from '../../notifications/services/notifications.service'

type ReadyJobData = {
    videoId: string
    workspaceId: string
}

/**
 * Listens to the `video-ready` BullMQ queue that the video-worker publishes
 * after a successful transcode. Looks up who originally uploaded the video
 * (via the audit log — we record `video.upload.create` with the actor) and
 * sends them an in-app + email notification.
 *
 * Failures are logged but never re-throw: a missed notification must not
 * block the queue.
 */
@Processor('video-ready')
export class VideoReadyProcessor extends WorkerHost {
    private readonly logger = new Logger(VideoReadyProcessor.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationsService,
    ) {
        super()
    }

    async process(job: Job<ReadyJobData>): Promise<void> {
        const { videoId, workspaceId } = job.data
        if (!videoId) return

        try {
            const [video, workspace, uploadEvent] = await Promise.all([
                this.prisma.video.findUnique({
                    where: { id: videoId },
                    select: { id: true, title: true },
                }),
                this.prisma.workspace.findUnique({
                    where: { id: workspaceId },
                    select: { id: true, name: true },
                }),
                this.prisma.auditEvent.findFirst({
                    where: {
                        action: 'video.startUpload',
                        targetId: videoId,
                    },
                    orderBy: { createdAt: 'asc' },
                    select: { actorId: true },
                }),
            ])

            if (!video || !workspace) return

            const actorId = uploadEvent?.actorId
            if (!actorId) {
                this.logger.warn(
                    `No uploader found in audit log for video ${videoId}`,
                )
                return
            }

            const actor = await this.prisma.user.findUnique({
                where: { id: actorId },
                select: { email: true },
            })

            if (!actor?.email) return

            await this.notifications.sendNotification({
                userId: actorId,
                type: 'EMAIL',
                identity: actor.email,
                topic: `Видео готово · ${workspace.name}`,
                message: `Ваше видео «${video.title}» обработано и доступно для просмотра.`,
                metadata: {
                    videoId: video.id,
                    workspaceId: workspace.id,
                    kind: 'video.ready',
                },
            })
        } catch (error) {
            this.logger.error(
                `Failed to dispatch video-ready notification for ${videoId}`,
                error instanceof Error ? error.stack : String(error),
            )
        }
    }
}
