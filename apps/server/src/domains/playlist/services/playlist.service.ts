import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { FilesService } from '../../../infrastructure/files/services/files.service'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { reorderIds } from '../../../shared/utils/reorder'
import { loadCompletedVideoIds } from './course-access.service'
import {
    type AudienceRow,
    audienceRowSelect,
    buildCourseAudienceWhere,
    type CourseLock,
    type CourseViewer,
    computeProgressionLocks,
    describeAudience,
    evaluateCourseAudience,
    PROGRESSION_LOCK_REASON,
} from './course-audience'
import { buildCourseVisibilityClauses } from './playlist-visibility'

@Injectable()
export class PlaylistService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly filesService: FilesService,
    ) {}

    async createThumbnailUpload(payload: {
        workspaceId: string
        playlistId: string
        contentType: string
    }) {
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
            },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        const bucket = this.filesService.getDefaultBucketName()
        // Under thumbnails/: it's one of only two anonymously readable prefixes
        // (the bucket is private), and getPublicObjectUrl hands the cover out
        // unsigned. Covers used to land in playlists/ and came back 403.
        const key = `thumbnails/playlists/${payload.playlistId}/${randomUUID()}`
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

    async createPlaylist(payload: {
        workspaceId: string
        data: {
            title: string
            slug: string
            description?: string | null
            thumbnailUrl?: string | null
            status?: string | null
            level?: string | null
            lockedProgression?: boolean
            isPublic?: boolean
            publishedAt?: string | null
            tags?: string[]
        }
    }) {
        const playlist = await this.prisma.course.create({
            data: {
                workspaceId: payload.workspaceId,
                title: payload.data.title,
                slug: payload.data.slug,
                description: payload.data.description,
                thumbnailUrl: payload.data.thumbnailUrl,
                status: payload.data.status,
                level: payload.data.level,
                lockedProgression: payload.data.lockedProgression ?? false,
                isPublic: payload.data.isPublic ?? true,
                publishedAt: payload.data.publishedAt
                    ? new Date(payload.data.publishedAt)
                    : null,
                tags: payload.data.tags ?? [],
            },
        })

        return serializePlaylist(playlist)
    }

    async updatePlaylist(payload: {
        workspaceId: string
        playlistId: string
        data: {
            title?: string
            slug?: string
            description?: string | null
            thumbnailUrl?: string | null
            status?: string | null
            level?: string | null
            lockedProgression?: boolean
            isPublic?: boolean
            publishedAt?: string | null
            tags?: string[]
        }
    }) {
        const existing = await this.prisma.course.findFirst({
            where: { id: payload.playlistId, workspaceId: payload.workspaceId },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        const playlist = await this.prisma.course.update({
            where: { id: payload.playlistId },
            data: {
                title: payload.data.title,
                slug: payload.data.slug,
                description: payload.data.description,
                thumbnailUrl: payload.data.thumbnailUrl,
                status: payload.data.status,
                level: payload.data.level,
                lockedProgression: payload.data.lockedProgression,
                isPublic: payload.data.isPublic,
                ...(payload.data.publishedAt !== undefined && {
                    publishedAt: payload.data.publishedAt
                        ? new Date(payload.data.publishedAt)
                        : null,
                }),
                tags: payload.data.tags,
            },
        })

        return serializePlaylist(playlist)
    }

    async deletePlaylist(payload: { workspaceId: string; playlistId: string }) {
        const existing = await this.prisma.course.findFirst({
            where: { id: payload.playlistId, workspaceId: payload.workspaceId },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        await this.prisma.course.delete({
            where: { id: payload.playlistId },
        })
    }

    async getPlaylist(payload: {
        workspaceId: string
        playlistId: string
        // Staff see drafts and every audience; a student sees published
        // courses minus those hidden from them by group, with rank/plan
        // courses as locked teasers.
        viewer: CourseViewer
        // Whose VideoWatched rows drive the locked-progression locks.
        userId: string
    }) {
        const { viewer } = payload
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
                AND: [
                    ...buildCourseVisibilityClauses({
                        includeUnpublished: viewer.isStaff,
                    }),
                    ...buildCourseAudienceWhere(viewer),
                ],
            },
            include: {
                audience: { select: audienceRowSelect },
                chapters: { orderBy: { order: 'asc' } },
                videos: {
                    orderBy: [{ order: 'asc' }, { videoId: 'asc' }],
                    include: {
                        video: {
                            select: {
                                id: true,
                                title: true,
                                description: true,
                                status: true,
                                duration: true,
                                thumbnailUrl: true,
                            },
                        },
                    },
                },
            },
        })

        const verdict = playlist
            ? evaluateCourseAudience(playlist.audience, viewer)
            : null
        if (!playlist || !verdict || verdict.hidden) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        // A locked course locks every lesson with the same reason; otherwise
        // locked progression opens lessons one by one for students.
        let progressionLocked = new Set<string>()
        if (!verdict.lock && playlist.lockedProgression && !viewer.isStaff) {
            const lessons = playlist.videos.map((entry) => ({
                videoId: entry.videoId,
                isOptional: entry.isOptional,
            }))
            const completed = await loadCompletedVideoIds(
                this.prisma,
                payload.userId,
                lessons.map((l) => l.videoId),
            )
            progressionLocked = computeProgressionLocks(lessons, completed)
        }
        const lessonLock = (videoId: string): CourseLock | null =>
            verdict.lock ??
            (progressionLocked.has(videoId)
                ? { kind: 'PROGRESSION', reason: PROGRESSION_LOCK_REASON }
                : null)

        // Lookup table so the response can ship a denormalised
        // `chapterTitle` next to every lesson — the mobile client still
        // consumes that shape and we don't want a breaking change.
        const chapterTitleById = new Map<string, string>()
        for (const c of playlist.chapters) chapterTitleById.set(c.id, c.title)

        return {
            ...serializePlaylistSummary(playlist, viewer),
            chapters: playlist.chapters.map((c) => ({
                id: c.id,
                title: c.title,
                order: c.order,
            })),
            videos: playlist.videos.map((entry) => ({
                id: entry.video.id,
                title: entry.video.title,
                description: entry.video.description,
                status: entry.video.status,
                duration: entry.video.duration,
                thumbnailUrl: entry.video.thumbnailUrl,
                order: entry.order,
                chapterId: entry.chapterId,
                chapterTitle: entry.chapterId
                    ? chapterTitleById.get(entry.chapterId) ?? null
                    : null,
                isOptional: entry.isOptional,
                lock: lessonLock(entry.video.id),
            })),
        }
    }

    async updatePlaylistVideo(payload: {
        workspaceId: string
        playlistId: string
        videoId: string
        data: {
            chapterId?: string | null
        }
    }) {
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
            },
            select: { id: true },
        })

        if (!playlist) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        const row = await this.prisma.courseVideo.findUnique({
            where: {
                courseId_videoId: {
                    courseId: payload.playlistId,
                    videoId: payload.videoId,
                },
            },
            select: { courseId: true },
        })

        if (!row) {
            throw new NotFoundError({
                message: 'Видео не входит в этот курс',
            })
        }

        if (payload.data.chapterId !== undefined && payload.data.chapterId) {
            // Make sure the chapter belongs to this playlist; without this
            // check a malicious client could attach a lesson to a chapter
            // from a different course.
            const chapter = await this.prisma.chapter.findFirst({
                where: {
                    id: payload.data.chapterId,
                    courseId: payload.playlistId,
                },
                select: { id: true },
            })
            if (!chapter) {
                throw new NotFoundError({
                    message: 'Раздел не найден в этом курсе',
                })
            }
        }

        const updated = await this.prisma.courseVideo.update({
            where: {
                courseId_videoId: {
                    courseId: payload.playlistId,
                    videoId: payload.videoId,
                },
            },
            data: {
                ...(payload.data.chapterId !== undefined && {
                    chapterId: payload.data.chapterId,
                }),
            },
            select: { videoId: true, chapterId: true, order: true },
        })

        return {
            videoId: updated.videoId,
            chapterId: updated.chapterId,
            order: updated.order,
        }
    }

    async createChapter(payload: {
        workspaceId: string
        playlistId: string
        title: string
    }) {
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
            },
            select: { id: true },
        })
        if (!playlist) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }
        const last = await this.prisma.chapter.findFirst({
            where: { courseId: payload.playlistId },
            orderBy: { order: 'desc' },
            select: { order: true },
        })
        const chapter = await this.prisma.chapter.create({
            data: {
                courseId: payload.playlistId,
                title: payload.title.trim(),
                order: (last?.order ?? -1) + 1,
            },
            select: { id: true, title: true, order: true },
        })
        return chapter
    }

    async updateChapter(payload: {
        workspaceId: string
        playlistId: string
        chapterId: string
        data: { title?: string }
    }) {
        const chapter = await this.prisma.chapter.findFirst({
            where: {
                id: payload.chapterId,
                courseId: payload.playlistId,
                course: { workspaceId: payload.workspaceId },
            },
            select: { id: true },
        })
        if (!chapter) {
            throw new NotFoundError({ message: 'Раздел не найден' })
        }
        const title = payload.data.title?.trim()
        if (title !== undefined && title.length === 0) {
            throw new BadRequestError({
                message: 'Название раздела не может быть пустым',
            })
        }
        const updated = await this.prisma.chapter.update({
            where: { id: payload.chapterId },
            data: { ...(title !== undefined && { title }) },
            select: { id: true, title: true, order: true },
        })
        return updated
    }

    async moveChapter(payload: {
        workspaceId: string
        playlistId: string
        chapterId: string
        afterChapterId?: string | null
        beforeChapterId?: string | null
    }) {
        if (
            payload.afterChapterId === undefined &&
            payload.beforeChapterId === undefined
        ) {
            throw new BadRequestError({
                message: 'Укажите afterChapterId, beforeChapterId или оба',
            })
        }
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
            },
            select: { id: true },
        })
        if (!playlist) {
            throw new NotFoundError({ message: 'Курс не найден' })
        }

        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.chapter.findMany({
                where: { courseId: payload.playlistId },
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                select: { id: true },
            })
            const movingIdx = rows.findIndex((r) => r.id === payload.chapterId)
            if (movingIdx === -1) {
                throw new NotFoundError({ message: 'Раздел не найден' })
            }
            const nextIds = reorderIds(
                rows.map((r) => r.id),
                payload.chapterId,
                {
                    afterId: payload.afterChapterId,
                    beforeId: payload.beforeChapterId,
                },
            )
            await Promise.all(
                nextIds.map((id, idx) =>
                    tx.chapter.update({
                        where: { id },
                        data: { order: idx },
                    }),
                ),
            )
            return {
                chapterId: payload.chapterId,
                order: nextIds.indexOf(payload.chapterId),
            }
        })
    }

    async deleteChapter(payload: {
        workspaceId: string
        playlistId: string
        chapterId: string
    }) {
        const chapter = await this.prisma.chapter.findFirst({
            where: {
                id: payload.chapterId,
                courseId: payload.playlistId,
                course: { workspaceId: payload.workspaceId },
            },
            select: { id: true },
        })
        if (!chapter) {
            throw new NotFoundError({ message: 'Раздел не найден' })
        }
        // SetNull cascade detaches lessons; they remain in the course as
        // ungrouped rows.
        await this.prisma.chapter.delete({ where: { id: payload.chapterId } })
    }

    async listPlaylists(payload: {
        workspaceId: string
        curPage?: number
        perPage?: number
        q?: string
        viewer: CourseViewer
    }) {
        const perPage = payload.perPage ?? 20
        const curPage = payload.curPage ?? 1
        const skip = Math.max(curPage - 1, 0) * perPage

        const term = payload.q?.trim()
        // Visibility expressed as AND-clauses so it composes with the
        // text-search OR without one OR overwriting the other when we
        // spread the object. Group-restricted courses a student isn't in are
        // dropped here (so totals and pages stay right); rank/plan ones stay
        // as teasers and get their lock below.
        const visibilityClauses = [
            ...buildCourseVisibilityClauses({
                includeUnpublished: payload.viewer.isStaff,
            }),
            ...buildCourseAudienceWhere(payload.viewer),
        ]
        const where = term
            ? {
                  workspaceId: payload.workspaceId,
                  AND: [
                      ...visibilityClauses,
                      {
                          OR: [
                              {
                                  title: {
                                      contains: term,
                                      mode: 'insensitive' as const,
                                  },
                              },
                              {
                                  description: {
                                      contains: term,
                                      mode: 'insensitive' as const,
                                  },
                              },
                              { tags: { has: term } },
                          ],
                      },
                  ],
              }
            : {
                  workspaceId: payload.workspaceId,
                  AND: visibilityClauses,
              }

        const [data, total] = await this.prisma.$transaction([
            this.prisma.course.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip,
                take: perPage,
                include: { audience: { select: audienceRowSelect } },
            }),
            this.prisma.course.count({ where }),
        ])

        return {
            data: data.map((course) =>
                serializePlaylistSummary(course, payload.viewer),
            ),
            total,
            curPage,
            perPage,
        }
    }
}

const serializePlaylist = (playlist: {
    id: string
    workspaceId: string
    title: string
    slug: string
    description: string | null
    thumbnailUrl: string | null
    status: string | null
    level: string | null
    lockedProgression: boolean
    isPublic: boolean
    publishedAt: Date | null
    tags: string[]
    createdAt: Date
    updatedAt: Date
}) => ({
    id: playlist.id,
    workspaceId: playlist.workspaceId,
    title: playlist.title,
    slug: playlist.slug,
    description: playlist.description,
    thumbnailUrl: playlist.thumbnailUrl,
    status: playlist.status,
    level: playlist.level,
    lockedProgression: playlist.lockedProgression,
    isPublic: playlist.isPublic,
    publishedAt: playlist.publishedAt
        ? playlist.publishedAt.toISOString()
        : null,
    tags: playlist.tags,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
})

// The member-facing read shape: the course plus why it is locked for this
// viewer (null = open) and, for staff only, who it is meant for.
const serializePlaylistSummary = (
    playlist: Parameters<typeof serializePlaylist>[0] & {
        audience: AudienceRow[]
    },
    viewer: CourseViewer,
) => ({
    ...serializePlaylist(playlist),
    lock: evaluateCourseAudience(playlist.audience, viewer).lock,
    audienceSummary: viewer.isStaff ? describeAudience(playlist.audience) : null,
})
