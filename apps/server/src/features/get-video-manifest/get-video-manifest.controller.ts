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
                'Invalid or expired token',
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

        const membership = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: payload.userId,
                    workspaceId: video.workspaceId,
                },
            },
            select: { id: true, status: true },
        })

        if (!membership || membership.status !== 'ACTIVE') {
            throw new HttpException('Forbidden', HttpStatus.FORBIDDEN)
        }

        const bucket =
            video.hlsBucket ?? this.filesService.getDefaultBucketName()

        // Allow only keys under this video's HLS prefix to be served.
        const masterDir = video.hlsMasterKey
            .split('/')
            .slice(0, -1)
            .join('/')
        const allowedPrefix = masterDir ? `${masterDir}/` : ''

        let key = video.hlsMasterKey
        if (subPath) {
            const decoded = decodeURIComponent(subPath)
            if (
                decoded.includes('..') ||
                (allowedPrefix && !decoded.startsWith(allowedPrefix))
            ) {
                throw new HttpException(
                    'Invalid path',
                    HttpStatus.BAD_REQUEST,
                )
            }
            key = decoded
        }

        const manifest = await this.filesService.getObjectText({ bucket, key })
        const playlistDir = key.split('/').slice(0, -1).join('/')

        const lines = manifest.split(/\r?\n/)
        const rewritten = await Promise.all(
            lines.map(async (line) => {
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith('#')) return line
                if (
                    trimmed.startsWith('http://') ||
                    trimmed.startsWith('https://')
                ) {
                    return line
                }

                const childKey = playlistDir
                    ? `${playlistDir}/${trimmed}`
                    : trimmed

                if (trimmed.endsWith('.m3u8')) {
                    // Recurse through this same endpoint so we can sign segments
                    // referenced inside the variant playlist as well.
                    return `manifest.m3u8?token=${encodeURIComponent(token)}&path=${encodeURIComponent(childKey)}`
                }

                return await this.filesService.getPresignedGetUrl({
                    bucket,
                    key: childKey,
                })
            }),
        )

        return rewritten.join('\n')
    }
}
