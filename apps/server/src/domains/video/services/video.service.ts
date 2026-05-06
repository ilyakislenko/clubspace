import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { environment } from '../../../environments/environment'
import { FilesService } from '../../../infrastructure/files/services/files.service'
import { Prisma, PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors/shared.errors'
import { issuePlaybackToken } from '../../../shared/utils/playback-token.util'

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
            include: {
                tags: {
                    include: { primary: true },
                },
                categories: {
                    include: { category: true },
                    orderBy: { order: 'asc' },
                },
                courses: {
                    include: { course: true },
                    orderBy: { order: 'asc' },
                },
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        return serializeVideo(video)
    }

    async listVideos(payload: {
        workspaceId: string
        curPage?: number
        perPage?: number
        q?: string
        tagId?: string
        categoryId?: string
    }) {
        const perPage = payload.perPage ?? 24
        const curPage = payload.curPage ?? 1
        const skip = Math.max(curPage - 1, 0) * perPage

        const term = payload.q?.trim()
        const where: Prisma.VideoWhereInput = {
            workspaceId: payload.workspaceId,
            ...(term && {
                OR: [
                    { title: { contains: term, mode: 'insensitive' } },
                    { description: { contains: term, mode: 'insensitive' } },
                ],
            }),
            // The tag relation uses VideoTag.primaryId; categories live on
            // VideoCategory.categoryId. `some` keeps the join cheap and works
            // when the user combines several filters at once.
            ...(payload.tagId && {
                tags: { some: { primaryId: payload.tagId } },
            }),
            ...(payload.categoryId && {
                categories: { some: { categoryId: payload.categoryId } },
            }),
        }

        const [data, total] = await this.prisma.$transaction([
            this.prisma.video.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: perPage,
                include: {
                    tags: {
                        include: { primary: true },
                    },
                    categories: {
                        include: { category: true },
                        orderBy: { order: 'asc' },
                    },
                    courses: {
                        include: { course: true },
                        orderBy: { order: 'asc' },
                    },
                },
            }),
            this.prisma.video.count({ where }),
        ])

        return {
            data: data.map(serializeVideo),
            total,
            curPage,
            perPage,
        }
    }

    async createThumbnailUpload(payload: {
        workspaceId: string
        videoId: string
        contentType: string
    }) {
        const video = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
            select: { id: true },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        const bucket = this.filesService.getDefaultBucketName()
        const key = `thumbnails/${payload.videoId}/${randomUUID()}`
        const upload = await this.filesService.getPresignedPutUrl({
            bucket,
            key,
            contentType: payload.contentType,
        })
        const publicUrl = this.filesService.getPublicObjectUrl({ bucket, key })

        return {
            upload,
            key,
            publicUrl,
        }
    }

    async updateVideo(payload: {
        workspaceId: string
        videoId: string
        data: {
            title?: string
            description?: string | null
            thumbnailUrl?: string | null
            isPublic?: boolean
            tagIds?: string[]
            categoryIds?: string[]
            playlistIds?: string[]
            playlistId?: string | null
        }
    }) {
        const video = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
            select: { id: true },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        if (payload.data.tagIds) {
            const tags = await this.prisma.tagEntity.findMany({
                where: {
                    id: { in: payload.data.tagIds },
                    workspaceId: payload.workspaceId,
                },
                select: { id: true },
            })

            if (tags.length !== payload.data.tagIds.length) {
                throw new BadRequestError({ message: 'Some tags are invalid' })
            }
        }

        if (payload.data.categoryIds) {
            const categories = await this.prisma.category.findMany({
                where: {
                    id: { in: payload.data.categoryIds },
                    workspaceId: payload.workspaceId,
                },
                select: { id: true },
            })

            if (categories.length !== payload.data.categoryIds.length) {
                throw new BadRequestError({ message: 'Some categories are invalid' })
            }
        }

        if (payload.data.playlistId) {
            const course = await this.prisma.course.findFirst({
                where: {
                    id: payload.data.playlistId,
                    workspaceId: payload.workspaceId,
                },
                select: { id: true },
            })

            if (!course) {
                throw new BadRequestError({ message: 'Playlist not found' })
            }
        }

        if (payload.data.playlistIds) {
            const courses = await this.prisma.course.findMany({
                where: {
                    id: { in: payload.data.playlistIds },
                    workspaceId: payload.workspaceId,
                },
                select: { id: true },
            })

            if (courses.length !== payload.data.playlistIds.length) {
                throw new BadRequestError({ message: 'Some playlists are invalid' })
            }
        }

        await this.prisma.$transaction(async (tx) => {
            const updateData: VideoUpdateData = {
                title: payload.data.title,
                description: payload.data.description,
                thumbnailUrl: payload.data.thumbnailUrl,
            }

            if (payload.data.isPublic !== undefined) {
                updateData.isPublic = payload.data.isPublic
            }

            await tx.video.update({
                where: { id: payload.videoId },
                data: updateData,
            })

            if (payload.data.tagIds) {
                await tx.videoTag.deleteMany({
                    where: { videoId: payload.videoId },
                })

                if (payload.data.tagIds.length) {
                    await tx.videoTag.createMany({
                        data: payload.data.tagIds.map((tagId) => ({
                            videoId: payload.videoId,
                            primaryId: tagId,
                        })),
                    })
                }
            }

            if (payload.data.categoryIds) {
                await tx.videoCategory.deleteMany({
                    where: { videoId: payload.videoId },
                })

                if (payload.data.categoryIds.length) {
                    await tx.videoCategory.createMany({
                        data: payload.data.categoryIds.map((categoryId, index) => ({
                            videoId: payload.videoId,
                            categoryId,
                            order: index + 1,
                        })),
                    })
                }
            }

            // Append after the current last item of THAT playlist.
            const appendToCourse = async (courseId: string) => {
                const last = await tx.courseVideo.findFirst({
                    where: { courseId },
                    orderBy: { order: 'desc' },
                    select: { order: true },
                })
                await tx.courseVideo.create({
                    data: {
                        courseId,
                        videoId: payload.videoId,
                        order: (last?.order ?? -1) + 1,
                    },
                })
            }

            if (payload.data.playlistIds) {
                await tx.courseVideo.deleteMany({
                    where: { videoId: payload.videoId },
                })
                for (const courseId of payload.data.playlistIds) {
                    await appendToCourse(courseId)
                }
            } else if (payload.data.playlistId !== undefined) {
                await tx.courseVideo.deleteMany({
                    where: { videoId: payload.videoId },
                })
                if (payload.data.playlistId) {
                    await appendToCourse(payload.data.playlistId)
                }
            }
        })

        const updated = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
            include: {
                tags: {
                    include: { primary: true },
                },
                categories: {
                    include: { category: true },
                    orderBy: { order: 'asc' },
                },
                courses: {
                    include: { course: true },
                    orderBy: { order: 'asc' },
                },
            },
        })

        if (!updated) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        return serializeVideo(updated)
    }

    async getPlaybackUrl(payload: { videoId: string; userId: string }) {
        const video = await this.prisma.video.findUnique({
            where: { id: payload.videoId },
            select: {
                id: true,
                workspaceId: true,
                status: true,
                hlsMasterKey: true,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        const [workspaceRow, membership] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: video.workspaceId },
                select: { ownerId: true },
            }),
            this.prisma.workspaceMember.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: payload.userId,
                        workspaceId: video.workspaceId,
                    },
                },
                select: { id: true, status: true, accessUntil: true },
            }),
        ])

        if (!membership) {
            throw new ForbiddenError({
                message: 'Not a member of this workspace',
            })
        }

        const isOwner = workspaceRow?.ownerId === payload.userId
        if (!isOwner) {
            if (membership.status !== 'ACTIVE') {
                throw new ForbiddenError({ message: 'Member is not active' })
            }
            if (
                membership.accessUntil &&
                membership.accessUntil < new Date()
            ) {
                throw new ForbiddenError({
                    message: 'Access window has expired',
                })
            }
        }

        if (video.status !== 'ready' || !video.hlsMasterKey) {
            throw new BadRequestError({ message: 'Video is not ready' })
        }

        const token = issuePlaybackToken({
            videoId: video.id,
            userId: payload.userId,
        })

        const base = environment.rootUrl.replace(/\/$/, '')
        return {
            hlsUrl: `${base}/videos/${video.id}/manifest.m3u8?token=${token}`,
        }
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

const serializeVideo = (video: {
    id: string
    workspaceId: string
    title: string
    description: string | null
    status: string
    isPublic?: boolean
    url: string
    duration: number | null
    thumbnailUrl: string | null
    errorMessage?: string | null
    createdAt: Date
    updatedAt: Date
    tags?: Array<{
        id: string
        primary: {
            id: string
            workspaceId: string
            type: string
            name: string
            slug: string
            description: string | null
            createdAt: Date
            updatedAt: Date
        }
    }>
    categories?: Array<{
        category: {
            id: string
            workspaceId: string
            name: string
            slug: string
            parentId: string | null
            order: number
            createdAt: Date
            updatedAt: Date
        }
    }>
    courses?: Array<{
        course: {
            id: string
            workspaceId: string
            title: string
            slug: string
            description: string | null
            thumbnailUrl: string | null
            status: string | null
            accessLevel: string | null
            level: string | null
            lockedProgression: boolean
            tags: string[]
            createdAt: Date
            updatedAt: Date
        }
    }>
}) => ({
    id: video.id,
    workspaceId: video.workspaceId,
    title: video.title,
    description: video.description,
    status: video.status,
    isPublic: video.isPublic ?? false,
    url: video.url,
    duration: video.duration,
    thumbnailUrl: video.thumbnailUrl,
    errorMessage: video.errorMessage,
    tags: video.tags?.map((tag) => ({
        id: tag.primary.id,
        workspaceId: tag.primary.workspaceId,
        type: tag.primary.type,
        name: tag.primary.name,
        slug: tag.primary.slug,
        description: tag.primary.description,
        createdAt: tag.primary.createdAt.toISOString(),
        updatedAt: tag.primary.updatedAt.toISOString(),
    })) ?? [],
    categories:
        video.categories?.map((category) => ({
            id: category.category.id,
            workspaceId: category.category.workspaceId,
            name: category.category.name,
            slug: category.category.slug,
            parentId: category.category.parentId,
            order: category.category.order,
            createdAt: category.category.createdAt.toISOString(),
            updatedAt: category.category.updatedAt.toISOString(),
        })) ?? [],
    playlists:
        video.courses?.map((course) => ({
            id: course.course.id,
            workspaceId: course.course.workspaceId,
            title: course.course.title,
            slug: course.course.slug,
            description: course.course.description,
            thumbnailUrl: course.course.thumbnailUrl,
            status: course.course.status,
            accessLevel: course.course.accessLevel,
            level: course.course.level,
            lockedProgression: course.course.lockedProgression,
            tags: course.course.tags,
            createdAt: course.course.createdAt.toISOString(),
            updatedAt: course.course.updatedAt.toISOString(),
        })) ?? [],
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString(),
})

type VideoUpdateData = {
    title?: string
    description?: string | null
    thumbnailUrl?: string | null
    isPublic?: boolean
}
