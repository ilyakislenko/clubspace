import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'

@Injectable()
export class CategoryService {
    constructor(private readonly prisma: PrismaService) {}

    async listCategories(payload: { workspaceId: string; parentId?: string | null }) {
        return await this.prisma.category.findMany({
            where: {
                workspaceId: payload.workspaceId,
                parentId: payload.parentId === undefined ? undefined : payload.parentId,
            },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        })
    }

    async createCategory(payload: {
        workspaceId: string
        data: {
            name: string
            slug: string
            parentId?: string | null
            order?: number
        }
    }) {
        return await this.prisma.category.create({
            data: {
                workspaceId: payload.workspaceId,
                name: payload.data.name,
                slug: payload.data.slug,
                parentId: payload.data.parentId ?? null,
                order: payload.data.order ?? 0,
            },
        })
    }

    async updateCategory(payload: {
        workspaceId: string
        categoryId: string
        data: {
            name?: string
            slug?: string
            parentId?: string | null
            order?: number
        }
    }) {
        const existing = await this.prisma.category.findFirst({
            where: { id: payload.categoryId, workspaceId: payload.workspaceId },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundError({ message: 'Category not found' })
        }

        return await this.prisma.category.update({
            where: { id: payload.categoryId },
            data: {
                name: payload.data.name,
                slug: payload.data.slug,
                parentId:
                    payload.data.parentId === undefined
                        ? undefined
                        : payload.data.parentId,
                order: payload.data.order,
            },
        })
    }

    async deleteCategory(payload: { workspaceId: string; categoryId: string }) {
        const existing = await this.prisma.category.findFirst({
            where: { id: payload.categoryId, workspaceId: payload.workspaceId },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundError({ message: 'Category not found' })
        }

        try {
            await this.prisma.category.delete({
                where: { id: payload.categoryId },
            })
        } catch {
            throw new BadRequestError({
                message: 'Unable to delete category. It might be attached to videos.',
            })
        }
    }
}
