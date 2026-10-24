import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { environment } from '../../../environments/environment'
import { FilesService } from '../../../infrastructure/files/services/files.service'
import { Prisma, PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../shared/errors/shared.errors'
import { issuePlaybackToken } from '../../../shared/utils/playback-token.util'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { announceVideoIfLive } from './announce-video'

const tooLargeMessage = (maxBytes: number) =>
    `Файл больше ${Math.round(maxBytes / 1024 ** 3)} ГБ. Сожмите видео или разделите его на части.`

const assertUploadSize = (sizeBytes: number, maxBytes: number) => {
    if (sizeBytes > maxBytes) {
        throw new BadRequestError({ message: tooLargeMessage(maxBytes) })
    }
}

@Injectable()
export class VideoService {
    private readonly logger = new Logger(VideoService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly filesService: FilesService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async createUpload(payload: {
        workspaceId: string
        title: string
        description?: string
        contentType: string
        sizeBytes: number
    }) {
        // Refuse before anything is written or signed. The client's number is
        // only a courtesy check — completeUpload measures the real object.
        assertUploadSize(payload.sizeBytes, this.filesService.getMaxVideoUploadBytes())

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
            throw new BadRequestError({ message: 'Не удалось подготовить загрузку файла' })
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
            throw new NotFoundError({ message: 'Видео не найдено' })
        }

        if (!video.rawKey) {
            throw new BadRequestError({ message: 'Файл не загружен (нет rawKey)' })
        }

        const rawBucket = video.rawBucket ?? this.filesService.getDefaultBucketName()
        const size = await this.filesService.getObjectSize({
            bucket: rawBucket,
            key: video.rawKey,
        })

        if (size === null) {
            throw new BadRequestError({ message: 'Загруженный файл не найден' })
        }

        // The presigned PUT can't enforce a size, so a client that lied in
        // createUpload is caught here: drop the object rather than keep it on
        // the disk, and fail the video so it doesn't sit in "uploading".
        const maxBytes = this.filesService.getMaxVideoUploadBytes()
        if (size > maxBytes) {
            await this.filesService.deleteObject({ bucket: rawBucket, key: video.rawKey })
            await this.prisma.video.update({
                where: { id: video.id },
                data: { status: 'failed', errorMessage: tooLargeMessage(maxBytes) },
            })
            throw new BadRequestError({ message: tooLargeMessage(maxBytes) })
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
                timestamps: {
                    orderBy: { positionSec: 'asc' },
                },
                subtitles: {
                    orderBy: [{ isDefault: 'desc' }, { language: 'asc' }],
                },
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Видео не найдено' })
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
            throw new NotFoundError({ message: 'Видео не найдено' })
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

    // ---- Subtitles ----

    async createSubtitleUpload(payload: {
        workspaceId: string
        videoId: string
        language: string
        contentType: string
    }) {
        const video = await this.prisma.video.findFirst({
            where: { id: payload.videoId, workspaceId: payload.workspaceId },
            select: { id: true },
        })
        if (!video) throw new NotFoundError({ message: 'Видео не найдено' })

        const bucket = this.filesService.getDefaultBucketName()
        // Language goes in the path so a re-upload of "ru" overwrites the
        // previous Russian track instead of orphaning files. The unique
        // constraint on (videoId, language) at the DB layer reinforces it.
        const key = `subtitles/${payload.videoId}/${payload.language}/${randomUUID()}.vtt`
        const upload = await this.filesService.getPresignedPutUrl({
            bucket,
            key,
            contentType: payload.contentType,
        })
        const publicUrl = this.filesService.getPublicObjectUrl({ bucket, key })
        return { upload, key, publicUrl }
    }

    async createSubtitle(payload: {
        workspaceId: string
        videoId: string
        language: string
        label: string
        storageKey: string
        publicUrl: string
        isDefault?: boolean
    }) {
        const video = await this.prisma.video.findFirst({
            where: { id: payload.videoId, workspaceId: payload.workspaceId },
            select: { id: true },
        })
        if (!video) throw new NotFoundError({ message: 'Видео не найдено' })

        // Replace any existing track for this language atomically — the
        // unique index enforces it and the prior storageKey may already be
        // orphaned in S3 (best-effort cleanup before swap).
        const existing = await this.prisma.videoSubtitle.findUnique({
            where: {
                videoId_language: {
                    videoId: payload.videoId,
                    language: payload.language,
                },
            },
            select: { id: true, storageKey: true },
        })
        if (existing) {
            await this.filesService
                .deleteObject({
                    bucket: this.filesService.getDefaultBucketName(),
                    key: existing.storageKey,
                })
                .catch(() => {
                    /* deleting the orphan is best-effort; the row is what
                       drives serving, and an S3 leftover is harmless. */
                })
            await this.prisma.videoSubtitle.delete({
                where: { id: existing.id },
            })
        }

        const created = await this.prisma.videoSubtitle.create({
            data: {
                videoId: payload.videoId,
                language: payload.language,
                label: payload.label,
                storageKey: payload.storageKey,
                publicUrl: payload.publicUrl,
                isDefault: payload.isDefault ?? false,
            },
        })

        if (created.isDefault) {
            // Only one default per video. Clear the flag on every other row
            // in the same shot.
            await this.prisma.videoSubtitle.updateMany({
                where: {
                    videoId: payload.videoId,
                    id: { not: created.id },
                },
                data: { isDefault: false },
            })
        }

        return {
            id: created.id,
            language: created.language,
            label: created.label,
            publicUrl: created.publicUrl,
            isDefault: created.isDefault,
        }
    }

    async deleteSubtitle(payload: {
        workspaceId: string
        videoId: string
        subtitleId: string
    }) {
        const subtitle = await this.prisma.videoSubtitle.findFirst({
            where: {
                id: payload.subtitleId,
                videoId: payload.videoId,
                video: { workspaceId: payload.workspaceId },
            },
            select: { id: true, storageKey: true },
        })
        if (!subtitle) {
            throw new NotFoundError({ message: 'Субтитры не найдены' })
        }

        await this.prisma.videoSubtitle.delete({ where: { id: subtitle.id } })
        await this.filesService
            .deleteObject({
                bucket: this.filesService.getDefaultBucketName(),
                key: subtitle.storageKey,
            })
            .catch(() => {
                /* row already removed; S3 leftover is acceptable */
            })

        return { status: 'deleted' as const }
    }

    async updateVideo(payload: {
        workspaceId: string
        videoId: string
        // The staff member performing the update — excluded from the
        // "new video" announcement (you don't get notified about your own).
        actorId?: string
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
            throw new NotFoundError({ message: 'Видео не найдено' })
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
                throw new BadRequestError({ message: 'Часть тегов не найдена' })
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
                throw new BadRequestError({ message: 'Часть категорий не найдена' })
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
                throw new BadRequestError({ message: 'Курс не найден' })
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
                throw new BadRequestError({ message: 'Часть курсов не найдена' })
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

        // If this edit moved the video into a course it may now be visible to
        // members — fire a best-effort "new video" alert (a notification hiccup
        // must not fail the edit). Publishing a course itself sends its own
        // course-level push; this covers a video added to an already-live one.
        if (
            payload.data.playlistIds !== undefined ||
            payload.data.playlistId !== undefined
        ) {
            try {
                await announceVideoIfLive(this.prisma, this.notifications, {
                    workspaceId: payload.workspaceId,
                    videoId: payload.videoId,
                    actorId: payload.actorId,
                })
            } catch (err) {
                this.logger.warn(
                    `Failed to announce video ${payload.videoId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }

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
            throw new NotFoundError({ message: 'Видео не найдено' })
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
            throw new NotFoundError({ message: 'Видео не найдено' })
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

        const isOwner = workspaceRow?.ownerId === payload.userId
        if (!isOwner) {
            // The owner has no membership row in the normal workspace-creation
            // flow, so the existence check must live inside the non-owner
            // branch — otherwise the owner can't play back their own video.
            if (!membership) {
                throw new ForbiddenError({
                    message: 'Вы не участник этого клуба',
                })
            }
            if (membership.status !== 'ACTIVE') {
                throw new ForbiddenError({ message: 'Участник неактивен' })
            }
            if (
                membership.accessUntil &&
                membership.accessUntil < new Date()
            ) {
                throw new ForbiddenError({
                    message: 'Срок доступа истёк',
                })
            }
        }

        if (video.status !== 'ready' || !video.hlsMasterKey) {
            throw new BadRequestError({ message: 'Видео ещё обрабатывается' })
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

    // Flat, downloadable HLS media playlist for offline use: one rung (720p,
    // falling back to the lowest if absent) with ABSOLUTE presigned segment
    // URLs, so the mobile client can fetch each segment directly without
    // walking the master/variant tree. Membership-gated, same as playback.
    async getOfflineManifest(payload: {
        videoId: string
        userId: string
    }): Promise<{ manifest: string }> {
        const video = await this.prisma.video.findUnique({
            where: { id: payload.videoId },
            select: {
                id: true,
                workspaceId: true,
                status: true,
                hlsBucket: true,
                hlsMasterKey: true,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Видео не найдено' })
        }

        await this.assertWorkspaceMemberAccess(video.workspaceId, payload.userId)

        if (video.status !== 'ready' || !video.hlsMasterKey) {
            throw new BadRequestError({ message: 'Видео ещё обрабатывается' })
        }

        const bucket =
            video.hlsBucket ?? this.filesService.getDefaultBucketName()
        const masterDir = video.hlsMasterKey.split('/').slice(0, -1).join('/')

        // Prefer the 720p rung (v1); fall back to the lowest (v0) if the
        // ladder ever produced fewer variants.
        let variantKey = `${masterDir}/v1/playlist.m3u8`
        let mediaPlaylist: string
        try {
            mediaPlaylist = await this.filesService.getObjectText({
                bucket,
                key: variantKey,
            })
        } catch {
            variantKey = `${masterDir}/v0/playlist.m3u8`
            mediaPlaylist = await this.filesService.getObjectText({
                bucket,
                key: variantKey,
            })
        }

        const variantDir = variantKey.split('/').slice(0, -1).join('/')
        const lines = mediaPlaylist.split(/\r?\n/)
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
                // Sign the segment with extra headroom for a slow download.
                return await this.filesService.getPresignedGetUrl({
                    bucket,
                    key: `${variantDir}/${trimmed}`,
                    expiresInSeconds: 6 * 60 * 60,
                })
            }),
        )

        return { manifest: rewritten.join('\n') }
    }

    // Shared workspace access gate for offline endpoints: the owner (who has no
    // membership row in the normal creation flow) is allowed before the
    // !membership throw, otherwise an active, non-expired membership is required.
    private async assertWorkspaceMemberAccess(
        workspaceId: string,
        userId: string,
    ): Promise<void> {
        const [workspaceRow, membership] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
            this.prisma.workspaceMember.findUnique({
                where: { userId_workspaceId: { userId, workspaceId } },
                select: { status: true, accessUntil: true },
            }),
        ])

        if (workspaceRow?.ownerId === userId) return
        if (!membership) {
            throw new ForbiddenError({
                message: 'Вы не участник этого клуба',
            })
        }
        if (membership.status !== 'ACTIVE') {
            throw new ForbiddenError({ message: 'Участник неактивен' })
        }
        if (membership.accessUntil && membership.accessUntil < new Date()) {
            throw new ForbiddenError({ message: 'Срок доступа истёк' })
        }
    }

    // A single presigned, progressive-MP4 URL for offline download. The mobile
    // client stores one file and plays it from file://, which works on iOS and
    // Android — unlike the HLS renditions, which AVPlayer cannot play from a
    // local file. Sourced from the uploaded original; a transcoded 720p MP4 rung
    // would be a smaller/safer source long-term, but the pipeline only emits HLS.
    async getOfflineDownload(payload: {
        videoId: string
        userId: string
    }): Promise<{ url: string; mimeType: string }> {
        const video = await this.prisma.video.findUnique({
            where: { id: payload.videoId },
            select: {
                id: true,
                workspaceId: true,
                status: true,
                rawBucket: true,
                rawKey: true,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Видео не найдено' })
        }

        await this.assertWorkspaceMemberAccess(video.workspaceId, payload.userId)

        if (video.status !== 'ready' || !video.rawKey) {
            throw new BadRequestError({ message: 'Видео ещё обрабатывается' })
        }

        const bucket =
            video.rawBucket ?? this.filesService.getDefaultBucketName()
        const url = await this.filesService.getPresignedGetUrl({
            bucket,
            key: video.rawKey,
            expiresInSeconds: 6 * 60 * 60,
        })

        return { url, mimeType: 'video/mp4' }
    }

    async deleteVideo(payload: { videoId: string; workspaceId: string }) {
        const video = await this.prisma.video.findFirst({
            where: {
                id: payload.videoId,
                workspaceId: payload.workspaceId,
            },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Видео не найдено' })
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
    timestamps?: Array<{
        id: string
        positionSec: number
        title: string
    }>
    subtitles?: Array<{
        id: string
        language: string
        label: string
        publicUrl: string
        isDefault: boolean
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
    timestamps: video.timestamps?.map((ts) => ({
        id: ts.id,
        positionSec: ts.positionSec,
        title: ts.title,
    })) ?? [],
    subtitles: video.subtitles?.map((s) => ({
        id: s.id,
        language: s.language,
        label: s.label,
        publicUrl: s.publicUrl,
        isDefault: s.isDefault,
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
