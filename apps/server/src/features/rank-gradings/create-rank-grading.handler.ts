import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateRankGradingFeature,
    CreateRankGradingFeatureResponse,
} from './create-rank-grading.feature'
import { loadGradingDetail } from './grading-detail'

@Feature(CreateRankGradingFeature)
export class CreateRankGradingHandler
    implements
        IFeatureHandler<
            CreateRankGradingFeature,
            CreateRankGradingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreateRankGradingFeature) {
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
        const p = f.payload

        const ladder = await this.prisma.rankLadder.findFirst({
            where: { id: p.ladderId, workspaceId: f.workspaceId },
            select: { id: true, name: true, isActive: true },
        })
        if (!ladder) throw new NotFoundError({ message: 'Лестница не найдена' })
        if (!ladder.isActive) {
            throw new BadRequestError({
                message: 'Лестница в архиве — выберите действующую',
            })
        }
        if (p.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: p.gymId, workspaceId: f.workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
        }

        const feeAmount = p.feeAmount ?? null
        const created = await this.prisma.rankGrading.create({
            data: {
                workspaceId: f.workspaceId,
                ladderId: ladder.id,
                date: ymdToDbDate(p.date),
                title: p.title ?? `Аттестация · ${ladder.name}`,
                gymId: p.gymId ?? null,
                feeAmount,
                feeCurrency:
                    feeAmount !== null ? (p.feeCurrency ?? 'RUB').toUpperCase() : null,
                createdById: f.invokerUserId,
            },
            select: { id: true },
        })
        const detail = await loadGradingDetail(
            this.prisma,
            f.workspaceId,
            created.id,
        )
        if (!detail) throw new NotFoundError({ message: 'Аттестация не найдена' })
        return detail
    }
}
