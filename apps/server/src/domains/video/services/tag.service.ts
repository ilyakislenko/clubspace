import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma';
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors';

@Injectable()
export class TagService {
    constructor(private readonly prisma: PrismaService) {}

    async listTags(payload: { workspaceId: string; type?: string }) {
        return await this.prisma.tagEntity.findMany({
            where: {
                workspaceId: payload.workspaceId,
                type: payload.type,
            },
            orderBy: [{ type: 'asc' }, { name: 'asc' }],
        })
    }

    async createTag(payload: {
        workspaceId: string
        data: {
            type: string
            name: string
            slug: string
            description?: string | null
        }
    }) {
        return await this.prisma.tagEntity.create({
            data: {
                workspaceId: payload.workspaceId,
                type: payload.data.type,
                name: payload.data.name,
                slug: payload.data.slug,
                description: payload.data.description ?? null,
            },
        })
    }

    async updateTag(payload: {
        workspaceId: string
        tagId: string
        data: {
            type?: string
            name?: string
            slug?: string
            description?: string | null
        }
    }) {
        const existing = await this.prisma.tagEntity.findFirst({
            where: { id: payload.tagId, workspaceId: payload.workspaceId },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundError({ message: 'Tag not found' })
        }

        return await this.prisma.tagEntity.update({
            where: { id: payload.tagId },
            data: {
                type: payload.data.type,
                name: payload.data.name,
                slug: payload.data.slug,
                description: payload.data.description,
            },
        })
    }

    async deleteTag(payload: { workspaceId: string; tagId: string }) {
        const existing = await this.prisma.tagEntity.findFirst({
            where: { id: payload.tagId, workspaceId: payload.workspaceId },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundError({ message: 'Tag not found' })
        }

        try {
            await this.prisma.tagEntity.delete({
                where: { id: payload.tagId },
            })
        } catch (error) {
            throw new BadRequestError({
                message: 'Unable to delete tag. It might be attached to videos.',
            })
        }
    }
}
