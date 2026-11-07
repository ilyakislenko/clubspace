import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'

// The worker's `video-chapters` queue (transcript, automatic subtitles,
// chapters, «Техники»). The worker queues the regular job itself after a
// transcode; staff's «Пересоздать» queues this one, with its own job id so a
// pending regular job can't swallow it.
export const regenerateJobId = (videoId: string) => `chapters-regen-${videoId}`

export type RegenerationState = 'waiting' | 'active' | null

@Injectable()
export class VideoTextProducer {
    constructor(@InjectQueue('video-chapters') private readonly queue: Queue) {}

    /** Whether a regeneration of the video is queued or running. */
    async regenerationState(videoId: string): Promise<RegenerationState> {
        const job = await this.queue.getJob(regenerateJobId(videoId))
        if (!job) return null
        const state = await job.getState()
        if (state === 'active') return 'active'
        return ['waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)
            ? 'waiting'
            : null
    }

    async enqueueRegeneration(videoId: string): Promise<void> {
        const jobId = regenerateJobId(videoId)
        // A finished job left behind would hold the id and swallow the add.
        const previous = await this.queue.getJob(jobId)
        if (previous && ((await previous.isFailed()) || (await previous.isCompleted()))) {
            await previous.remove()
        }
        // Same options as the worker's own chapters jobs.
        await this.queue.add(
            'video-chapters',
            { videoId, regenerate: true },
            { jobId, removeOnComplete: true, removeOnFail: true },
        )
    }
}
