import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { FilesService } from '../../../infrastructure/files/services/files.service'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { reorderIds } from '../../../shared/utils/reorder'
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
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        const bucket = this.filesService.getDefaultBucketName()
        const key = `playlists/${payload.playlistId}/${randomUUID()}`
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
            accessLevel?: string | null
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
                accessLevel: payload.data.accessLevel,
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
            accessLevel?: string | null
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
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        const playlist = await this.prisma.course.update({
            where: { id: payload.playlistId },
            data: {
                title: payload.data.title,
                slug: payload.data.slug,
                description: payload.data.description,
                thumbnailUrl: payload.data.thumbnailUrl,
                status: payload.data.status,
                accessLevel: payload.data.accessLevel,
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
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        await this.prisma.course.delete({
            where: { id: payload.playlistId },
        })
    }

    async getPlaylist(payload: {
        workspaceId: string
        playlistId: string
        // Staff readers see drafts; students don't. A draft is a course with no
        // publish date yet, so a coach can prep it before scheduling it.
        includeUnpublished?: boolean
    }) {
        // Students see a course once its publish date has arrived (YouTube-style
        // scheduled publish). Draft (publishedAt null) and scheduled (future)
        // rows stay hidden; staff see everything so they can prep them.
        const visibilityFilter = payload.includeUnpublished
            ? {}
            : { publishedAt: { lte: new Date() } }
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
                ...visibilityFilter,
            },
            include: {
                chapters: { orderBy: { order: 'asc' } },
                videos: {
                    orderBy: { order: 'asc' },
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

        if (!playlist) {
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        // Lookup table so the response can ship a denormalised
        // `chapterTitle` next to every lesson — the mobile client still
        // consumes that shape and we don't want a breaking change.
        const chapterTitleById = new Map<string, string>()
        for (const c of playlist.chapters) chapterTitleById.set(c.id, c.title)

        return {
            ...serializePlaylist(playlist),
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
            throw new NotFoundError({ message: 'Playlist not found' })
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
                message: 'Video is not attached to this playlist',
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
                    message: 'Chapter not found in this playlist',
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
            throw new NotFoundError({ message: 'Playlist not found' })
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
            throw new NotFoundError({ message: 'Chapter not found' })
        }
        const title = payload.data.title?.trim()
        if (title !== undefined && title.length === 0) {
            throw new BadRequestError({
                message: 'Chapter title cannot be empty',
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
                message: 'Provide afterChapterId, beforeChapterId, or both',
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
            throw new NotFoundError({ message: 'Playlist not found' })
        }

        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.chapter.findMany({
                where: { courseId: payload.playlistId },
                orderBy: [{ order: 'asc' }, { id: 'asc' }],
                select: { id: true },
            })
            const movingIdx = rows.findIndex((r) => r.id === payload.chapterId)
            if (movingIdx === -1) {
                throw new NotFoundError({ message: 'Chapter not found' })
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
            throw new NotFoundError({ message: 'Chapter not found' })
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
        includeUnpublished?: boolean
    }) {
        const perPage = payload.perPage ?? 20
        const curPage = payload.curPage ?? 1
        const skip = Math.max(curPage - 1, 0) * perPage

        const term = payload.q?.trim()
        // Visibility expressed as AND-clauses so it composes with the
        // text-search OR without one OR overwriting the other when we
        // spread the object.
        const visibilityClauses = buildCourseVisibilityClauses({
            includeUnpublished: payload.includeUnpublished,
        })
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
            }),
            this.prisma.course.count({ where }),
        ])

        return {
            data: data.map(serializePlaylist),
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
    accessLevel: string | null
    level: string | null
    lockedProgression: boolean
    isPublic: boolean
    publishedAt: Date | null
    tags: string[]
    createdAt: Date
    updatedAt: Date
}) => ({
    ...playlist,
    publishedAt: playlist.publishedAt
        ? playlist.publishedAt.toISOString()
        : null,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
})
