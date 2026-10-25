import { Feature, IFeatureHandler } from '@shelfjs/features'

import { dbDateToYmd, ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import {
    currentLevelRun,
    evaluateReadiness,
    nextLevelAfter,
} from '../../domains/ranks/rank-readiness'
import { countVisitsSince } from '../../domains/ranks/visits-since'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    GetRankReadinessFeature,
    GetRankReadinessFeatureResponse,
} from './get-rank-readiness.feature'

const USER_SELECT = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
} as const

type Entry = GetRankReadinessFeatureResponse['data'][number]

const sortName = (e: Entry): string =>
    [e.lastname, e.firstname].filter(Boolean).join(' ') || e.email

// «Кто готов к аттестации»: members with a rank on the ladder whose next level
// has a rule («допуск»), measured from when they reached their current level.
// Unranked members and members at the top are left out. A coach sees their own
// groups' members unless the club lets coaches read all groups.
@Feature(GetRankReadinessFeature)
export class GetRankReadinessHandler
    implements
        IFeatureHandler<GetRankReadinessFeature, GetRankReadinessFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetRankReadinessFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const now = new Date()

        const [workspace, ladders] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: { timezone: true },
            }),
            this.prisma.rankLadder.findMany({
                where: { workspaceId: f.workspaceId, isActive: true },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                select: {
                    id: true,
                    name: true,
                    levels: {
                        orderBy: { order: 'asc' },
                        select: {
                            id: true,
                            name: true,
                            color: true,
                            order: true,
                            isActive: true,
                            minVisits: true,
                            minWeeks: true,
                        },
                    },
                },
            }),
        ])
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })

        const ladderList = ladders.map((l) => ({ id: l.id, name: l.name }))
        if (f.payload.ladderId && !ladders.some((l) => l.id === f.payload.ladderId)) {
            throw new NotFoundError({ message: 'Лестница не найдена' })
        }
        if (ladders.length === 0) {
            return { ladders: [], ladderId: null, data: [] }
        }
        const ladder =
            ladders.find((l) => l.id === f.payload.ladderId) ?? ladders[0]

        if (f.payload.groupId) {
            const group = await this.prisma.group.findFirst({
                where: { id: f.payload.groupId, workspaceId: f.workspaceId },
                select: { id: true },
            })
            if (!group) throw new NotFoundError({ message: 'Группа не найдена' })
        }

        const [members, owner] = await Promise.all([
            this.prisma.workspaceMember.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    status: 'ACTIVE',
                    user: { deletedAt: null },
                },
                select: { user: { select: USER_SELECT } },
            }),
            this.prisma.user.findUnique({
                where: { id: ctx.workspaceOwnerId },
                select: USER_SELECT,
            }),
        ])
        const users = new Map(members.map((m) => [m.user.id, m.user]))
        if (owner) users.set(owner.id, owner)

        const canSeeAll = this.rbac.canSeeAllGroups(ctx)
        if (!canSeeAll || f.payload.groupId) {
            const inGroups = await this.prisma.groupMember.findMany({
                where: {
                    group: {
                        workspaceId: f.workspaceId,
                        ...(f.payload.groupId ? { id: f.payload.groupId } : {}),
                        ...(!canSeeAll
                            ? { coaches: { some: { userId: ctx.userId } } }
                            : {}),
                    },
                },
                select: { userId: true },
            })
            const allowed = new Set(inGroups.map((g) => g.userId))
            for (const id of [...users.keys()]) {
                if (!allowed.has(id)) users.delete(id)
            }
        }

        const promotions = await this.prisma.rankPromotion.findMany({
            where: {
                workspaceId: f.workspaceId,
                ladderId: ladder.id,
                userId: { in: [...users.keys()] },
            },
            orderBy: [{ userId: 'asc' }, { awardedAt: 'desc' }],
            select: {
                userId: true,
                levelId: true,
                stripes: true,
                awardedAt: true,
            },
        })
        const byUser = new Map<string, typeof promotions>()
        for (const p of promotions) {
            const list = byUser.get(p.userId)
            if (list) list.push(p)
            else byUser.set(p.userId, [p])
        }

        const levelById = new Map(ladder.levels.map((l) => [l.id, l]))
        const candidates = [...byUser.entries()].flatMap(([userId, list]) => {
            const run = currentLevelRun(list)
            const currentLevel = run ? levelById.get(run.levelId) : undefined
            const next = run ? nextLevelAfter(ladder.levels, run.levelId) : null
            return run && currentLevel && next
                ? [{ userId, run, currentLevel, next }]
                : []
        })

        const visits = await countVisitsSince(
            this.prisma,
            f.workspaceId,
            candidates.map((c) => ({ userId: c.userId, since: c.run.reachedAt })),
        )

        const today = ymdToDbDate(localDateInTz(now, workspace.timezone))
        const pending = await this.prisma.rankGradingCandidate.findMany({
            where: {
                workspaceId: f.workspaceId,
                userId: { in: candidates.map((c) => c.userId) },
                result: 'PENDING',
                grading: { ladderId: ladder.id, date: { gte: today } },
            },
            orderBy: { grading: { date: 'asc' } },
            select: {
                userId: true,
                grading: { select: { id: true, date: true } },
            },
        })
        const pendingByUser = new Map<string, { id: string; date: Date }>()
        for (const p of pending) {
            if (!pendingByUser.has(p.userId)) {
                pendingByUser.set(p.userId, p.grading)
            }
        }

        const data: Entry[] = candidates.map((c) => {
            const user = users.get(c.userId)!
            const r = evaluateReadiness({
                nextLevel: c.next,
                reachedAt: c.run.reachedAt,
                visitsSince: visits.get(c.userId) ?? 0,
                now,
            })
            const grading = pendingByUser.get(c.userId)
            return {
                userId: c.userId,
                firstname: user.firstname,
                lastname: user.lastname,
                email: user.email,
                isOwner: c.userId === ctx.workspaceOwnerId,
                current: {
                    levelId: c.currentLevel.id,
                    levelName: c.currentLevel.name,
                    color: c.currentLevel.color,
                    stripes: c.run.stripes,
                    reachedAt: c.run.reachedAt.toISOString(),
                },
                nextLevel: {
                    id: c.next.id,
                    name: c.next.name,
                    color: c.next.color,
                },
                ...r,
                pendingGrading: grading
                    ? { id: grading.id, date: dbDateToYmd(grading.date) }
                    : null,
            }
        })
        data.sort(
            (a, b) =>
                Number(b.ready) - Number(a.ready) ||
                a.remainingVisits - b.remainingVisits ||
                a.remainingWeeks - b.remainingWeeks ||
                sortName(a).localeCompare(sortName(b), 'ru'),
        )

        return { ladders: ladderList, ladderId: ladder.id, data }
    }
}
