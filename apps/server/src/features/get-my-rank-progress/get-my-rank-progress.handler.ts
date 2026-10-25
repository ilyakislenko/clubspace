import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    currentLevelRun,
    evaluateReadiness,
    nextLevelAfter,
} from '../../domains/ranks/rank-readiness'
import {
    dbDateToYmd,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    GetMyRankProgressFeature,
    GetMyRankProgressFeatureResponse,
} from './get-my-rank-progress.feature'

type Entry = GetMyRankProgressFeatureResponse['data'][number]

// Member-facing «до следующей аттестации»: per ladder the member holds, how
// far they are from the next level's rule, plus the grading they are listed
// for. Keyed on User, so the owner (no member row) works too. Archived ladders
// are left out.
@Feature(GetMyRankProgressFeature)
export class GetMyRankProgressHandler
    implements
        IFeatureHandler<GetMyRankProgressFeature, GetMyRankProgressFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMyRankProgressFeature) {
        const now = new Date()
        const [workspace, promotions] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: { timezone: true },
            }),
            this.prisma.rankPromotion.findMany({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                orderBy: { awardedAt: 'desc' },
                select: {
                    ladderId: true,
                    levelId: true,
                    stripes: true,
                    awardedAt: true,
                },
            }),
        ])
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        if (promotions.length === 0) return { data: [] }

        const byLadder = new Map<string, typeof promotions>()
        for (const p of promotions) {
            const list = byLadder.get(p.ladderId)
            if (list) list.push(p)
            else byLadder.set(p.ladderId, [p])
        }

        const ladders = await this.prisma.rankLadder.findMany({
            where: {
                workspaceId: f.workspaceId,
                isActive: true,
                id: { in: [...byLadder.keys()] },
            },
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
        })

        const today = ymdToDbDate(localDateInTz(now, workspace.timezone))
        const pending = await this.prisma.rankGradingCandidate.findMany({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                result: 'PENDING',
                grading: { date: { gte: today } },
            },
            orderBy: { grading: { date: 'asc' } },
            select: {
                level: { select: { name: true } },
                grading: {
                    select: {
                        id: true,
                        ladderId: true,
                        date: true,
                        title: true,
                        gym: { select: { name: true } },
                    },
                },
            },
        })
        const upcomingByLadder = new Map<string, (typeof pending)[number]>()
        for (const c of pending) {
            if (!upcomingByLadder.has(c.grading.ladderId)) {
                upcomingByLadder.set(c.grading.ladderId, c)
            }
        }

        // Bounded by the ladders the member holds (typically 1-2).
        const data: Entry[] = []
        for (const ladder of ladders) {
            const run = currentLevelRun(byLadder.get(ladder.id) ?? [])
            const currentLevel = run
                ? ladder.levels.find((l) => l.id === run.levelId)
                : undefined
            if (!run || !currentLevel) continue

            const next = nextLevelAfter(ladder.levels, run.levelId)
            const visitsSince = await this.prisma.attendanceRecord.count({
                where: {
                    workspaceId: f.workspaceId,
                    userId: f.userId,
                    markedAt: { gte: run.reachedAt },
                },
            })
            const r = evaluateReadiness({
                nextLevel: next ?? {},
                reachedAt: run.reachedAt,
                visitsSince,
                now,
            })
            const upcoming = upcomingByLadder.get(ladder.id)
            data.push({
                ladderId: ladder.id,
                ladderName: ladder.name,
                current: {
                    levelId: currentLevel.id,
                    levelName: currentLevel.name,
                    color: currentLevel.color,
                    stripes: run.stripes,
                    reachedAt: run.reachedAt.toISOString(),
                },
                nextLevel: next
                    ? { id: next.id, name: next.name, color: next.color }
                    : null,
                ...r,
                upcomingGrading: upcoming
                    ? {
                          gradingId: upcoming.grading.id,
                          date: dbDateToYmd(upcoming.grading.date),
                          title: upcoming.grading.title,
                          gymName: upcoming.grading.gym?.name ?? null,
                          levelName: upcoming.level.name,
                      }
                    : null,
            })
        }
        return { data }
    }
}
