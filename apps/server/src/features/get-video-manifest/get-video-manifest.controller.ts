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

        // Re-verify membership at fetch time, in case it was revoked.
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

        const manifest = await this.filesService.getObjectText({
            bucket,
            key: video.hlsMasterKey,
        })

        const masterDir = video.hlsMasterKey.split('/').slice(0, -1).join('/')
        const lines = manifest.split(/\r?\n/)
        const rewritten = await Promise.all(
            lines.map(async (line) => {
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith('#')) {
                    return line
                }
                if (
                    trimmed.startsWith('http://') ||
                    trimmed.startsWith('https://')
                ) {
                    return line
                }
                const segmentKey = masterDir
                    ? `${masterDir}/${trimmed}`
                    : trimmed
                return await this.filesService.getPresignedGetUrl({
                    bucket,
                    key: segmentKey,
                })
            }),
        )

        return rewritten.join('\n')
    }
}
