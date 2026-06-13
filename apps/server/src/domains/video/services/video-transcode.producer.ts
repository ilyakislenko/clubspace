import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'

@Injectable()
export class VideoTranscodeProducer {
    constructor(@InjectQueue('video-transcode') private readonly queue: Queue) {}

    async enqueue(videoId: string) {
        await this.queue.add(
            'video-transcode',
            { videoId },
            {
                // Dedupe by video: a double-clicked "retry" / complete-upload
                // won't enqueue a second transcode of the same video while one
                // is still pending or in-flight. The job is removed once it
                // finishes (below), freeing the id for a legitimate later retry.
                jobId: `transcode-${videoId}`,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                // Don't let finished jobs accumulate in Redis unbounded, and
                // free the dedupe id once the job is done (success or final
                // failure) so the video can be re-queued later.
                removeOnComplete: true,
                removeOnFail: true,
            },
        )
    }
}
