import {
    Controller,
    Get,
    Header,
    HttpException,
    HttpStatus,
    Param,
    Query,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { proxyHlsPlaylist } from '../../shared/utils/hls-playlist-proxy'
import { verifyPlaybackToken } from '../../shared/utils/playback-token.util'
import { canWatchReviewClip } from './review-clip-access'
import { reviewClipTokenSubject } from './video-reviews-utils'

/**
 * HLS proxy for «Разбор видео» clips — the club video proxy's twin for the
 * separate ReviewClip table. The token is bound to `review-<clipId>`, so a
 * club video token can't open a clip (or the other way round), and who may
 * watch (the clip's member, the club's staff) is re-checked on every fetch.
 */
@Controller('review-clips')
@SkipThrottle()
export class ReviewClipManifestController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly filesService: FilesService,
    ) {}

    @Get(':id/manifest.m3u8')
    @Header('Content-Type', 'application/vnd.apple.mpegurl')
    @Header('Cache-Control', 'private, max-age=60')
    async getReviewClipManifest(
        @Param('id') clipId: string,
        @Query('token') token: string | undefined,
        @Query('path') subPath: string | undefined,
    ) {
        if (!token) {
            throw new HttpException('Missing token', HttpStatus.UNAUTHORIZED)
        }
        const payload = verifyPlaybackToken(token)
        if (!payload || payload.videoId !== reviewClipTokenSubject(clipId)) {
            throw new HttpException(
                'Ссылка недействительна или устарела',
                HttpStatus.UNAUTHORIZED,
            )
        }

        const clip = await this.prisma.reviewClip.findUnique({
            where: { id: clipId },
            select: {
                workspaceId: true,
                ownerUserId: true,
                hlsBucket: true,
                hlsMasterKey: true,
            },
        })
        if (!clip || !clip.hlsMasterKey) {
            throw new HttpException('Video not ready', HttpStatus.NOT_FOUND)
        }
        if (!(await canWatchReviewClip(this.prisma, clip, payload.userId))) {
            throw new HttpException('Нет доступа к видео', HttpStatus.FORBIDDEN)
        }

        return await proxyHlsPlaylist(this.filesService, {
            bucket: clip.hlsBucket,
            masterKey: clip.hlsMasterKey,
            subPath,
            token,
        })
    }
}
