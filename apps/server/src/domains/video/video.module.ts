import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { FilesModule } from '../../infrastructure/files/files.module'
import { PrismaModule } from '../../infrastructure/prisma'
import { VideoTranscodeProducer } from './services/video-transcode.producer'
import { VideoService } from './services/video.service'


@Module({
    imports: [
        PrismaModule,
        FilesModule,
        BullModule.registerQueue({ name: 'video-transcode' }),
    ],
    providers: [VideoService, VideoTranscodeProducer],
    exports: [VideoService, VideoTranscodeProducer],
})
export class VideoModule {}
