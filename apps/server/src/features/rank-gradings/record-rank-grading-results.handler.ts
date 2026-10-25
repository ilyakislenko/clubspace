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
import { nameList } from './name-list'
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
        const ctx = await assertWorkspaceAdmin(
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

        await this.assertCanPromote(f.workspaceId, grading.ladderId, toPass, ctx.workspaceOwnerId)

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
                    let promotion
                    try {
                        promotion = await this.ranks.promoteInTx(tx, {
                            workspaceId: f.workspaceId,
                            userId: c.userId,
                            ladderId: grading.ladderId,
                            levelId: c.levelId,
                            stripes: c.stripes,
                            awardedById: f.invokerUserId,
                            note,
                        })
                    } catch (err) {
                        // The whole batch rolls back; say whose row did it.
                        if (
                            err instanceof BadRequestError ||
                            err instanceof NotFoundError
                        ) {
                            throw new BadRequestError({
                                message: `${nameOrPlaceholder(c.user)}: ${err.message}`,
                            })
                        }
                        throw err
                    }
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

    // Refuses, naming the people, anyone who left the club since being listed
    // or who already holds this level (with at least these stripes) or a
    // higher one — a PASSED must never write a demotion into the history.
    private async assertCanPromote(
        workspaceId: string,
        ladderId: string,
        toPass: {
            userId: string
            levelId: string
            stripes: number
            user: { firstname: string | null; lastname: string | null }
        }[],
        ownerId: string,
    ): Promise<void> {
        if (toPass.length === 0) return
        const userIds = toPass.map((c) => c.userId)

        const active = await this.prisma.workspaceMember.findMany({
            where: { workspaceId, status: 'ACTIVE', userId: { in: userIds } },
            select: { userId: true },
        })
        const eligible = new Set(active.map((m) => m.userId))
        eligible.add(ownerId)
        const inactive = toPass.filter((c) => !eligible.has(c.userId))
        if (inactive.length > 0) {
            throw new BadRequestError({
                message: `Не в клубе: ${nameList(inactive.map((c) => nameOrPlaceholder(c.user)))} — уберите из аттестации`,
            })
        }

        const [latest, targets] = await Promise.all([
            this.prisma.rankPromotion.findMany({
                where: { workspaceId, ladderId, userId: { in: userIds } },
                distinct: ['userId'],
                orderBy: { awardedAt: 'desc' },
                select: {
                    userId: true,
                    stripes: true,
                    level: { select: { order: true } },
                },
            }),
            this.prisma.rankLevel.findMany({
                where: { id: { in: toPass.map((c) => c.levelId) } },
                select: { id: true, order: true },
            }),
        ])
        const currentByUser = new Map(latest.map((p) => [p.userId, p]))
        const orderByLevel = new Map(targets.map((l) => [l.id, l.order]))
        const already = toPass.filter((c) => {
            const cur = currentByUser.get(c.userId)
            const target = orderByLevel.get(c.levelId)
            if (!cur || target === undefined) return false
            return (
                cur.level.order > target ||
                (cur.level.order === target && cur.stripes >= c.stripes)
            )
        })
        if (already.length > 0) {
            throw new BadRequestError({
                message: `Уже имеют этот или более высокий ранг: ${nameList(already.map((c) => nameOrPlaceholder(c.user)))}`,
            })
        }
    }
}
