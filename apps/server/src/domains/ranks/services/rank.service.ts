import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'

export type PromoteParams = {
    workspaceId: string
    // The member being promoted (User id).
    userId: string
    ladderId: string
    levelId: string
    stripes?: number
    awardedById: string
    note?: string | null
}

// Single place that records a promotion. A member's current rank on a ladder is
// derived as the most recent promotion — there is no denormalized pointer, so
// promoting is a pure append (history is immutable). Reused by any future
// automated-promotion path.
@Injectable()
export class RankService {
    constructor(private readonly prisma: PrismaService) {}

    async promote(params: PromoteParams) {
        const level = await this.prisma.rankLevel.findFirst({
            where: {
                id: params.levelId,
                ladderId: params.ladderId,
                ladder: { workspaceId: params.workspaceId },
            },
            select: { id: true, maxStripes: true },
        })
        if (!level) {
            throw new NotFoundError({
                message: 'Rank level not found in this ladder',
            })
        }

        const stripes = params.stripes ?? 0
        if (stripes < 0 || stripes > level.maxStripes) {
            throw new BadRequestError({
                message: `Stripes must be between 0 and ${level.maxStripes}`,
            })
        }

        return this.prisma.rankPromotion.create({
            data: {
                workspaceId: params.workspaceId,
                userId: params.userId,
                ladderId: params.ladderId,
                levelId: params.levelId,
                stripes,
                note: params.note ?? null,
                awardedById: params.awardedById,
            },
            include: {
                level: {
                    select: { id: true, name: true, color: true, order: true },
                },
                ladder: { select: { id: true, name: true } },
            },
        })
    }
}
