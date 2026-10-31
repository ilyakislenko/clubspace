import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'

// Failed transcodes stay in Redis this long, so the error and the attempt
// history can be inspected after the fact.
const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60

@Injectable()
export class VideoTranscodeProducer {
    constructor(@InjectQueue('video-transcode') private readonly queue: Queue) {}

    async enqueue(videoId: string) {
        const jobId = `transcode-${videoId}`
        // A kept failed job still holds the dedupe id below, and BullMQ
        // silently ignores an add() for an id it already has — so a new upload
        // of a video whose last transcode failed would never be processed.
        // Clear the old failure first; a pending or running job is left alone.
        const previous = await this.queue.getJob(jobId)
        if (previous && (await previous.isFailed())) {
            await previous.remove()
        }

        await this.queue.add(
            'video-transcode',
            { videoId },
            {
                // Dedupe by video: a double-clicked "retry" / complete-upload
                // won't enqueue a second transcode of the same video while one
                // is still pending or in-flight.
                jobId,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                // Finished jobs are dropped at once (freeing the dedupe id);
                // failed ones are kept for a week for inspection.
                removeOnComplete: true,
                removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
            },
        )
    }
}
