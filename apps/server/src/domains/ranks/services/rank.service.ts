import { Injectable } from '@nestjs/common'

import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
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

export type PromoteManyParams = Omit<PromoteParams, 'userId'> & {
    userIds: string[]
}

const PROMOTION_INCLUDE = {
    level: {
        select: { id: true, name: true, color: true, order: true },
    },
    ladder: { select: { id: true, name: true } },
} as const

// Single place that records a promotion. A member's current rank on a ladder is
// derived as the most recent promotion — there is no denormalized pointer, so
// promoting is a pure append (history is immutable). Reused by any future
// automated-promotion path.
@Injectable()
export class RankService {
    constructor(private readonly prisma: PrismaService) {}

    async promote(params: PromoteParams) {
        const stripes = await this.validatedStripes(params)
        return this.prisma.rankPromotion.create({
            data: this.promotionData(params, params.userId, stripes),
            include: PROMOTION_INCLUDE,
        })
    }

    // Same as promote(), but on the caller's transaction — a grading records its
    // result and the promotion atomically.
    async promoteInTx(tx: PrismaTransactionClientType, params: PromoteParams) {
        const stripes = await this.validatedStripes(params, tx)
        return tx.rankPromotion.create({
            data: this.promotionData(params, params.userId, stripes),
            include: PROMOTION_INCLUDE,
        })
    }

    // Batch variant: validates the level once, then writes every row in one
    // transaction, so a failure leaves nobody half-promoted.
    async promoteMany(params: PromoteManyParams) {
        const stripes = await this.validatedStripes(params)
        return this.prisma.$transaction(
            params.userIds.map((userId) =>
                this.prisma.rankPromotion.create({
                    data: this.promotionData(params, userId, stripes),
                    include: PROMOTION_INCLUDE,
                }),
            ),
        )
    }

    // The level must belong to this ladder in this workspace, and the stripes
    // must fit its cap. Returns the stripes to record.
    private async validatedStripes(
        params: Pick<
            PromoteParams,
            'workspaceId' | 'ladderId' | 'levelId' | 'stripes'
        >,
        db: PrismaTransactionClientType = this.prisma,
    ): Promise<number> {
        const level = await db.rankLevel.findFirst({
            where: {
                id: params.levelId,
                ladderId: params.ladderId,
                ladder: { workspaceId: params.workspaceId },
            },
            select: { id: true, maxStripes: true },
        })
        if (!level) {
            throw new NotFoundError({
                message: 'Ранг не найден в этой лестнице',
            })
        }

        const stripes = params.stripes ?? 0
        if (stripes < 0 || stripes > level.maxStripes) {
            throw new BadRequestError({
                message: `Полосок может быть от 0 до ${level.maxStripes}`,
            })
        }
        return stripes
    }

    private promotionData(
        params: Omit<PromoteParams, 'userId'>,
        userId: string,
        stripes: number,
    ) {
        return {
            workspaceId: params.workspaceId,
            userId,
            ladderId: params.ladderId,
            levelId: params.levelId,
            stripes,
            note: params.note ?? null,
            awardedById: params.awardedById,
        }
    }
}
