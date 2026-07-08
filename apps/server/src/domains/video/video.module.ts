import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { FilesModule } from '../../infrastructure/files/files.module'
import { PrismaModule } from '../../infrastructure/prisma'
import { NotificationProducerModule } from '../notifications/notification-producer.module'
import { CategoryService } from './services/category.service'
import { TagService } from './services/tag.service'
import { VideoTranscodeProducer } from './services/video-transcode.producer'
import { VideoService } from './services/video.service'


@Module({
    imports: [
        PrismaModule,
        FilesModule,
        // VideoService fires "new video" pushes via the producer.
        NotificationProducerModule,
        BullModule.registerQueue(
            { name: 'video-transcode' },
            { name: 'video-ready' },
        ),
    ],
    providers: [VideoService, TagService, CategoryService, VideoTranscodeProducer],
    exports: [
        VideoService,
        TagService,
        CategoryService,
        VideoTranscodeProducer,
        BullModule,
    ],
})
export class VideoModule {}
