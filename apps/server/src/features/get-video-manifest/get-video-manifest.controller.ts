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

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { proxyHlsPlaylist } from '../../shared/utils/hls-playlist-proxy'
import { verifyPlaybackToken } from '../../shared/utils/playback-token.util'

/**
 * HLS playback proxy.
 *
 * For an HLS master.m3u8 we cannot just hand out a presigned URL: variant
 * playlists referenced inside contain *relative* segment paths, which the
 * player would resolve against the S3 host — and those segments are private.
 *
 * So we proxy every .m3u8 lookup through this controller:
 *  - lines that look like another playlist (.m3u8) are rewritten to point
 *    back at this same endpoint with `path=<variant-key>`
 *  - lines that look like media segments (.ts/.m4s/...) are replaced with
 *    short-lived S3 presigned URLs.
 *
 * Single-bitrate manifests (only segments, no variants) work as a degenerate
 * case of the same logic.
 */
@Controller('videos')
@SkipThrottle()
export class GetVideoManifestController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly filesService: FilesService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    @Get(':id/manifest.m3u8')
    @Header('Content-Type', 'application/vnd.apple.mpegurl')
    @Header('Cache-Control', 'private, max-age=60')
    async getManifest(
        @Param('id') videoId: string,
        @Query('token') token: string | undefined,
        @Query('path') subPath: string | undefined,
    ) {
        if (!token) {
            throw new HttpException('Missing token', HttpStatus.UNAUTHORIZED)
        }

        const payload = verifyPlaybackToken(token)
        if (!payload || payload.videoId !== videoId) {
            throw new HttpException(
                'Ссылка недействительна или устарела',
                HttpStatus.UNAUTHORIZED,
            )
        }

        const video = await this.prisma.video.findUnique({
            where: { id: videoId },
            select: {
                id: true,
                workspaceId: true,
                hlsBucket: true,
                hlsMasterKey: true,
                status: true,
            },
        })

        if (!video || !video.hlsMasterKey) {
            throw new HttpException('Video not ready', HttpStatus.NOT_FOUND)
        }

        // Re-checked on every playlist fetch, not only when the token was
        // issued: a removed member, an expired window, a course unpublished or
        // narrowed to another audience stops playback within the token's life.
        await this.courseAccess.assertCanWatchVideo(video, payload.userId)

        return await proxyHlsPlaylist(this.filesService, {
            bucket: video.hlsBucket ?? this.filesService.getDefaultBucketName(),
            masterKey: video.hlsMasterKey,
            subPath,
            token,
        })
    }
}
