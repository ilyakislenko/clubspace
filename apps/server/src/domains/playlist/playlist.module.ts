import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { CourseAccessService } from './services/course-access.service'
import { PlaylistService } from './services/playlist.service'

@Module({
    imports: [PrismaModule],
    providers: [PlaylistService, CourseAccessService],
    exports: [PlaylistService, CourseAccessService],
})
export class PlaylistModule {}
