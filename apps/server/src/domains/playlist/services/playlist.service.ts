import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'

import { FilesService } from '../../../infrastructure/files/services/files.service'
import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'

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
            description?: string
            thumbnailUrl?: string
            status?: string
            accessLevel?: string
            level?: string
            lockedProgression?: boolean
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

    async getPlaylist(payload: { workspaceId: string; playlistId: string }) {
        const playlist = await this.prisma.course.findFirst({
            where: {
                id: payload.playlistId,
                workspaceId: payload.workspaceId,
            },
            include: {
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

        return {
            ...serializePlaylist(playlist),
            videos: playlist.videos.map((entry) => ({
                id: entry.video.id,
                title: entry.video.title,
                description: entry.video.description,
                status: entry.video.status,
                duration: entry.video.duration,
                thumbnailUrl: entry.video.thumbnailUrl,
                order: entry.order,
            })),
        }
    }

    async listPlaylists(payload: {
        workspaceId: string
        curPage?: number
        perPage?: number
        q?: string
    }) {
        const perPage = payload.perPage ?? 20
        const curPage = payload.curPage ?? 1
        const skip = Math.max(curPage - 1, 0) * perPage

        const term = payload.q?.trim()
        const where = term
            ? {
                  workspaceId: payload.workspaceId,
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
              }
            : { workspaceId: payload.workspaceId }

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
    tags: string[]
    createdAt: Date
    updatedAt: Date
}) => ({
    ...playlist,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
})
