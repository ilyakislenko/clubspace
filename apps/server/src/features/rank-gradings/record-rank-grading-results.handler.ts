import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RankService } from '../../domains/ranks/services/rank.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { nameOrPlaceholder } from '../../shared/utils/person-name'
import { notifyPromotion } from '../member-ranks/notify-promotion'
import { loadGradingDetail } from './grading-detail'
import {
    RecordRankGradingResultsFeature,
    RecordRankGradingResultsFeatureResponse,
} from './record-rank-grading-results.feature'

// Records exam results. PASSED is final: it creates the promotion (through the
// same RankService path as a manual promote, so awardedBy is the examiner) in
// the same transaction as the result. "Promote everyone left" is the client
// sending every PENDING candidate as PASSED.
@Feature(RecordRankGradingResultsFeature)
export class RecordRankGradingResultsHandler
    implements
        IFeatureHandler<
            RecordRankGradingResultsFeature,
            RecordRankGradingResultsFeatureResponse
        >
{
    private readonly logger = new Logger(RecordRankGradingResultsHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly ranks: RankService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: RecordRankGradingResultsFeature) {
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
        const grading = await this.prisma.rankGrading.findFirst({
            where: { id: f.gradingId, workspaceId: f.workspaceId },
            select: { id: true, title: true, date: true, ladderId: true },
        })
        if (!grading) throw new NotFoundError({ message: 'Аттестация не найдена' })

        // Last entry wins for a repeated candidate.
        const wanted = new Map(
            f.payload.results.map((r) => [r.candidateId, r.result]),
        )
        const candidates = await this.prisma.rankGradingCandidate.findMany({
            where: {
                gradingId: grading.id,
                workspaceId: f.workspaceId,
                id: { in: [...wanted.keys()] },
            },
            select: {
                id: true,
                userId: true,
                levelId: true,
                stripes: true,
                result: true,
                user: { select: { firstname: true, lastname: true } },
            },
        })
        if (candidates.length !== wanted.size) {
            throw new NotFoundError({
                message: 'Кандидат не найден в этой аттестации',
            })
        }

        const toPass: typeof candidates = []
        const toChange: { id: string; result: 'PENDING' | 'FAILED' }[] = []
        for (const c of candidates) {
            const result = wanted.get(c.id)!
            if (c.result === 'PASSED') {
                if (result !== 'PASSED') {
                    throw new BadRequestError({
                        message: `Результат «сдал» у ${nameOrPlaceholder(c.user)} уже записан и ранг присвоен — изменить его нельзя`,
                    })
                }
                continue
            }
            if (result === 'PASSED') toPass.push(c)
            else toChange.push({ id: c.id, result })
        }

        const now = new Date()
        const note = `${grading.title} · ${formatRuDate(grading.date, 'UTC')}`.slice(
            0,
            500,
        )
        const created = await this.prisma.$transaction(
            async (tx) => {
                const promotions: Awaited<
                    ReturnType<RankService['promoteInTx']>
                >[] = []
                for (const c of toPass) {
                    // The WHERE is re-checked under the row lock: if a concurrent
                    // request already passed this candidate, skip — one promotion.
                    const { count } = await tx.rankGradingCandidate.updateMany({
                        where: { id: c.id, result: { not: 'PASSED' } },
                        data: { result: 'PASSED', resultAt: now },
                    })
                    if (count === 0) continue
                    const promotion = await this.ranks.promoteInTx(tx, {
                        workspaceId: f.workspaceId,
                        userId: c.userId,
                        ladderId: grading.ladderId,
                        levelId: c.levelId,
                        stripes: c.stripes,
                        awardedById: f.invokerUserId,
                        note,
                    })
                    await tx.rankGradingCandidate.update({
                        where: { id: c.id },
                        data: { promotionId: promotion.id },
                    })
                    promotions.push(promotion)
                }
                for (const c of toChange) {
                    await tx.rankGradingCandidate.updateMany({
                        where: { id: c.id, result: { not: 'PASSED' } },
                        data: {
                            result: c.result,
                            resultAt: c.result === 'PENDING' ? null : now,
                        },
                    })
                }
                return promotions
            },
            { timeout: 30_000 },
        )

        this.realtime.invalidate(f.workspaceId, ['ranks'])

        // After commit, best-effort: the ranks are recorded either way.
        for (const promotion of created) {
            if (promotion.userId === f.invokerUserId) continue
            try {
                await notifyPromotion(this.notifications, f.workspaceId, promotion)
            } catch (err) {
                this.logger.warn(
                    `Promotion notice for ${promotion.userId} failed: ${String(err)}`,
                )
            }
        }

        const detail = await loadGradingDetail(
            this.prisma,
            f.workspaceId,
            grading.id,
        )
        if (!detail) throw new NotFoundError({ message: 'Аттестация не найдена' })
        return { promoted: created.length, grading: detail }
    }
}
