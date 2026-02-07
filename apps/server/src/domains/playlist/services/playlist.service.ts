import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'

@Injectable()
export class PlaylistService {
    constructor(private readonly prisma: PrismaService) {}

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

    async listPlaylists(payload: {
        workspaceId: string
        curPage?: number
        perPage?: number
    }) {
        const perPage = payload.perPage ?? 20
        const curPage = payload.curPage ?? 1
        const skip = Math.max(curPage - 1, 0) * perPage

        const [data, total] = await this.prisma.$transaction([
            this.prisma.course.findMany({
                where: { workspaceId: payload.workspaceId },
                orderBy: { updatedAt: 'desc' },
                skip,
                take: perPage,
            }),
            this.prisma.course.count({
                where: { workspaceId: payload.workspaceId },
            }),
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
