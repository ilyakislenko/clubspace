import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { nextLevelAfter } from '../../domains/ranks/rank-readiness'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { nameOrPlaceholder } from '../../shared/utils/person-name'
import {
    AddRankGradingCandidatesFeature,
    AddRankGradingCandidatesFeatureResponse,
} from './add-rank-grading-candidates.feature'
import { loadGradingDetail } from './grading-detail'
import { notifyGradingCandidate } from './notify-grading-candidate'

const NAMES_SHOWN = 5

const nameList = (names: string[]): string =>
    names.length > NAMES_SHOWN
        ? `${names.slice(0, NAMES_SHOWN).join(', ')} и ещё ${names.length - NAMES_SHOWN}`
        : names.join(', ')

// Puts members on a grading list. Each candidate is examined for the level
// above their current one on the ladder (or an explicit level for everyone).
// Eligibility is all-or-nothing, like the bulk promote; re-adding someone who
// is already a candidate is a no-op.
@Feature(AddRankGradingCandidatesFeature)
export class AddRankGradingCandidatesHandler
    implements
        IFeatureHandler<
            AddRankGradingCandidatesFeature,
            AddRankGradingCandidatesFeatureResponse
        >
{
    private readonly logger = new Logger(AddRankGradingCandidatesHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(f: AddRankGradingCandidatesFeature) {
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
            select: {
                id: true,
                ladderId: true,
                date: true,
                ladder: { select: { name: true } },
            },
        })
        if (!grading) throw new NotFoundError({ message: 'Аттестация не найдена' })

        const userIds = [...new Set(f.payload.userIds)]

        const active = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'ACTIVE',
                userId: { in: userIds },
            },
            select: { userId: true },
        })
        const eligible = new Set(active.map((m) => m.userId))
        if (userIds.includes(ctx.workspaceOwnerId)) {
            eligible.add(ctx.workspaceOwnerId)
        }
        if (eligible.size !== userIds.length) {
            throw new BadRequestError({
                message:
                    'Часть выбранных участников неактивна в этом клубе — обновите список',
            })
        }

        const levels = await this.prisma.rankLevel.findMany({
            where: { ladderId: grading.ladderId },
            orderBy: { order: 'asc' },
            select: { id: true, name: true, order: true, isActive: true },
        })
        const levelById = new Map(levels.map((l) => [l.id, l]))
        if (f.payload.levelId && !levelById.has(f.payload.levelId)) {
            throw new NotFoundError({
                message: 'Уровень не найден в этой лестнице',
            })
        }

        const existing = await this.prisma.rankGradingCandidate.findMany({
            where: { gradingId: grading.id, userId: { in: userIds } },
            select: { userId: true },
        })
        const already = new Set(existing.map((c) => c.userId))
        const newIds = userIds.filter((id) => !already.has(id))

        if (newIds.length > 0) {
            const [latest, users] = await Promise.all([
                this.prisma.rankPromotion.findMany({
                    where: {
                        workspaceId: f.workspaceId,
                        ladderId: grading.ladderId,
                        userId: { in: newIds },
                    },
                    distinct: ['userId'],
                    orderBy: { awardedAt: 'desc' },
                    select: { userId: true, levelId: true, stripes: true },
                }),
                this.prisma.user.findMany({
                    where: { id: { in: newIds } },
                    select: { id: true, firstname: true, lastname: true },
                }),
            ])
            const latestByUser = new Map(latest.map((p) => [p.userId, p]))
            const userById = new Map(users.map((u) => [u.id, u]))
            const nameOf = (id: string) =>
                nameOrPlaceholder(
                    userById.get(id) ?? { firstname: null, lastname: null },
                )

            const unranked: string[] = []
            const atTop: string[] = []
            const rows = newIds.flatMap((userId) => {
                const from = latestByUser.get(userId) ?? null
                const target =
                    f.payload.levelId !== undefined
                        ? levelById.get(f.payload.levelId)
                        : from
                          ? nextLevelAfter(levels, from.levelId)
                          : null
                if (!target) {
                    if (!from) unranked.push(nameOf(userId))
                    else atTop.push(nameOf(userId))
                    return []
                }
                return [
                    {
                        gradingId: grading.id,
                        workspaceId: f.workspaceId,
                        userId,
                        levelId: target.id,
                        stripes: 0,
                        fromLevelName: from
                            ? (levelById.get(from.levelId)?.name ?? null)
                            : null,
                        fromStripes: from ? from.stripes : null,
                    },
                ]
            })
            if (unranked.length > 0) {
                throw new BadRequestError({
                    message: `Нет ранга на этой лестнице: ${nameList(unranked)} — выберите уровень вручную`,
                })
            }
            if (atTop.length > 0) {
                throw new BadRequestError({
                    message: `Уже на высшем уровне: ${nameList(atTop)}`,
                })
            }

            await this.prisma.rankGradingCandidate.createMany({
                data: rows,
                skipDuplicates: true,
            })

            // Only the people who were just added hear about it; best-effort.
            for (const row of rows) {
                try {
                    await notifyGradingCandidate(
                        this.notifications,
                        f.workspaceId,
                        {
                            gradingId: grading.id,
                            ladderId: grading.ladderId,
                            userId: row.userId,
                            date: grading.date,
                            levelName: levelById.get(row.levelId)!.name,
                            ladderName: grading.ladder.name,
                        },
                    )
                } catch (err) {
                    this.logger.warn(
                        `Grading notice for ${row.userId} failed: ${String(err)}`,
                    )
                }
            }
        }

        const detail = await loadGradingDetail(
            this.prisma,
            f.workspaceId,
            grading.id,
        )
        if (!detail) throw new NotFoundError({ message: 'Аттестация не найдена' })
        return detail
    }
}
