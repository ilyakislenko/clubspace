import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { FilesService } from '../../../infrastructure/files/services/files.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors/shared.errors'

@Injectable()
export class VideoService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly filesService: FilesService,
    ) {}

    async createUpload(payload: {
        workspaceId: string
        title: string
        description?: string
        contentType: string
    }) {
        const bucket = this.filesService.getDefaultBucketName()
        const videoId = randomUUID()
        const rawKey = `raw/${videoId}/source.mp4`
        const video = await this.prisma.video
            .create({
                data: {
                    id: videoId,
                    workspaceId: payload.workspaceId,
                    title: payload.title,
                    description: payload.description,
                    url: '',
                    status: 'uploading',
                    rawBucket: bucket,
                    rawKey,
                    hlsBucket: bucket,
                },
                select: { id: true, rawKey: true },
            })

        if (!video.rawKey) {
            throw new BadRequestError({ message: 'rawKey was not generated' })
        }

        const upload = await this.filesService.getPresignedPutUrl({
            bucket,
            key: video.rawKey,
            contentType: payload.contentType,
        })

        return {
            videoId: video.id,
            rawKey: video.rawKey,
            upload,
        }
    }

    async completeUpload(payload: { videoId: string; workspaceId: string }) {
        const video = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
            select: {
                id: true,
                rawBucket: true,
                rawKey: true,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        if (!video.rawKey) {
            throw new BadRequestError({ message: 'rawKey is missing' })
        }

        const exists = await this.filesService.objectExists({
            bucket: video.rawBucket ?? this.filesService.getDefaultBucketName(),
            key: video.rawKey,
        })

        if (!exists) {
            throw new BadRequestError({ message: 'Uploaded file not found' })
        }

        await this.prisma.video.update({
            where: { id: video.id },
            data: { status: 'uploaded' },
        })
    }

    async getVideo(payload: { videoId: string; workspaceId: string }) {
        const video = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        return video
    }

    async listVideos(payload: {
        workspaceId: string
        curPage?: number
        perPage?: number
    }) {
        const perPage = payload.perPage ?? 24
        const curPage = payload.curPage ?? 1
        const skip = Math.max(curPage - 1, 0) * perPage

        const [data, total] = await this.prisma.$transaction([
            this.prisma.video.findMany({
                where: { workspaceId: payload.workspaceId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: perPage,
            }),
            this.prisma.video.count({
                where: { workspaceId: payload.workspaceId },
            }),
        ])

        return {
            data: data.map((video) => ({
                ...video,
                createdAt: video.createdAt.toISOString(),
                updatedAt: video.updatedAt.toISOString(),
            })),
            total,
            curPage,
            perPage,
        }
    }

    async getPlaybackUrl(payload: { videoId: string; userId: string }) {
        const video = await this.prisma.video.findUnique({
            where: { id: payload.videoId },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        const membership = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: payload.userId,
                    workspaceId: video.workspaceId,
                },
            },
            select: { id: true },
        })

        if (!membership) {
            throw new ForbiddenError({ message: 'Not a member of this workspace' })
        }

        if (video.status !== 'ready') {
            throw new BadRequestError({ message: 'Video is not ready' })
        }

        const url =
            video.url ||
            (video.hlsMasterKey
                ? this.filesService.getPublicObjectUrl({
                      bucket: video.hlsBucket ?? this.filesService.getDefaultBucketName(),
                      key: video.hlsMasterKey,
                  })
                : null)

        if (!url) {
            throw new BadRequestError({ message: 'Playback url is missing' })
        }

        return { hlsUrl: url }
    }

    async deleteVideo(payload: { videoId: string; workspaceId: string }) {
        const video = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        const rawBucket = video.rawBucket ?? this.filesService.getDefaultBucketName()
        if (video.rawKey) {
            await this.filesService.deleteObject({
                bucket: rawBucket,
                key: video.rawKey,
            })
        }

        const hlsBucket = video.hlsBucket ?? this.filesService.getDefaultBucketName()
        const hlsPrefix = video.hlsMasterKey
            ? video.hlsMasterKey.split('/').slice(0, -1).join('/')
            : `hls/${video.id}`

        if (hlsPrefix) {
            await this.filesService.deleteObjectsByPrefix({
                bucket: hlsBucket,
                prefix: hlsPrefix,
            })
        }

        await this.prisma.video.delete({
            where: { id: video.id },
        })

        return { status: 'deleted' as const }
    }
}
