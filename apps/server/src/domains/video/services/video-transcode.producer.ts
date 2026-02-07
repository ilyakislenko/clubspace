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
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
            },
        )
    }
}
