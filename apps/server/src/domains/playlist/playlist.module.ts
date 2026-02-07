import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { PlaylistService } from './services/playlist.service'

@Module({
    imports: [PrismaModule],
    providers: [PlaylistService],
    exports: [PlaylistService],
})
export class PlaylistModule {}
