import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadGradingDetail } from './grading-detail'
import {
    UpdateRankGradingCandidateFeature,
    UpdateRankGradingCandidateFeatureResponse,
} from './update-rank-grading-candidate.feature'

@Feature(UpdateRankGradingCandidateFeature)
export class UpdateRankGradingCandidateHandler
    implements
        IFeatureHandler<
            UpdateRankGradingCandidateFeature,
            UpdateRankGradingCandidateFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdateRankGradingCandidateFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Проводить аттестации может только администратор или главный тренер клуба',
        )
        const candidate = await this.prisma.rankGradingCandidate.findFirst({
            where: {
                id: f.candidateId,
                gradingId: f.gradingId,
                workspaceId: f.workspaceId,
            },
            select: {
                id: true,
                userId: true,
                result: true,
                levelId: true,
                stripes: true,
                paidAt: true,
                grading: { select: { ladderId: true } },
            },
        })
        if (!candidate) {
            throw new NotFoundError({
                message: 'Кандидат не найден в этой аттестации',
            })
        }

        const p = f.payload
        const data: {
            paidAt?: Date | null
            levelId?: string
            stripes?: number
        } = {}

        if (p.paid !== undefined) {
            data.paidAt = p.paid ? (candidate.paidAt ?? new Date()) : null
        }

        if (p.levelId !== undefined || p.stripes !== undefined) {
            if (candidate.result === 'PASSED') {
                throw new BadRequestError({
                    message: 'Результат уже записан — уровень изменить нельзя',
                })
            }
            const levelId = p.levelId ?? candidate.levelId
            const level = await this.prisma.rankLevel.findFirst({
                where: { id: levelId, ladderId: candidate.grading.ladderId },
                select: {
                    id: true,
                    maxStripes: true,
                    order: true,
                    isActive: true,
                },
            })
            if (!level) {
                throw new NotFoundError({
                    message: 'Уровень не найден в этой лестнице',
                })
            }
            // A different level must be a live one above where they stand now.
            if (levelId !== candidate.levelId) {
                if (!level.isActive) {
                    throw new BadRequestError({
                        message: 'Уровень в архиве — выберите действующий',
                    })
                }
                const current = await this.prisma.rankPromotion.findFirst({
                    where: {
                        workspaceId: f.workspaceId,
                        userId: candidate.userId,
                        ladderId: candidate.grading.ladderId,
                    },
                    orderBy: { awardedAt: 'desc' },
                    select: { level: { select: { order: true } } },
                })
                if (current && level.order <= current.level.order) {
                    throw new BadRequestError({
                        message: 'Уровень должен быть выше текущего ранга участника',
                    })
                }
            }
            // A different level starts from zero stripes unless told otherwise.
            const stripes =
                p.stripes ?? (levelId === candidate.levelId ? candidate.stripes : 0)
            if (stripes > level.maxStripes) {
                throw new BadRequestError({
                    message: `Полосок может быть от 0 до ${level.maxStripes}`,
                })
            }
            data.levelId = levelId
            data.stripes = stripes
        }

        await this.prisma.rankGradingCandidate.update({
            where: { id: candidate.id },
            data,
        })
        const detail = await loadGradingDetail(
            this.prisma,
            f.workspaceId,
            f.gradingId,
        )
        if (!detail) throw new NotFoundError({ message: 'Аттестация не найдена' })
        return detail
    }
}
