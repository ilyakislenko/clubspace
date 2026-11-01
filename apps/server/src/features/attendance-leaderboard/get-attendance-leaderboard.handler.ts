import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    assertDirectionInWorkspace,
    sessionInDirectionWhere,
} from '../../domains/directions/direction-scope'
import {
    MemberStatus,
    Prisma,
    PrismaService,
} from '../../infrastructure/prisma'
import { publicMemberName } from '../../shared/utils/person-name'
import {
    GetAttendanceLeaderboardFeature,
    GetAttendanceLeaderboardFeatureResponse,
    LeaderboardPeriod,
} from './get-attendance-leaderboard.feature'
import {
    LeaderboardBoard,
    LeaderboardCacheService,
} from './leaderboard-cache.service'
import {
    computeStreakWeeks,
    rankEntries,
    weekIndex,
} from './leaderboard-math'

const DAY_MS = 24 * 60 * 60 * 1000
const STREAK_LOOKBACK_WEEKS = 12

// Attendance leaderboard for one workspace + period. Any member reads it
// (owner included); a club-off switch or a member opt-out narrows what's
// shown. Ranking is over ACTIVE members only, so guests and removed members
// never surface on the board. The full-roster ranking is cached per club
// (LeaderboardCacheService); only the caller's streak is read per request.
// With a direction, only visits in sessions of that direction count — for the
// board and for the caller's streak alike.
@Feature(GetAttendanceLeaderboardFeature)
export class GetAttendanceLeaderboardHandler
    implements
        IFeatureHandler<
            GetAttendanceLeaderboardFeature,
            GetAttendanceLeaderboardFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: LeaderboardCacheService,
    ) {}

    async execute({
        workspaceId,
        userId,
        payload,
    }: GetAttendanceLeaderboardFeature) {
        const period: LeaderboardPeriod = payload.period ?? 'month'
        const directionId = payload.directionId ?? null
        await assertDirectionInWorkspace(this.prisma, workspaceId, directionId)
        const inDirection = directionId
            ? { session: sessionInDirectionWhere(directionId) }
            : {}
        const emptyMe = {
            checkins: 0,
            rank: null,
            streakWeeks: 0,
            hidden: false,
        }

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { leaderboardEnabled: true },
        })
        if (!workspace || !workspace.leaderboardEnabled) {
            return {
                enabled: false,
                period,
                directionId,
                entries: [],
                me: emptyMe,
            }
        }

        const now = new Date()
        const streakSince = new Date(
            now.getTime() - STREAK_LOOKBACK_WEEKS * 7 * DAY_MS,
        )

        const [board, myRecords] = await Promise.all([
            this.cache.getOrCompute(workspaceId, period, directionId, () =>
                this.computeBoard(workspaceId, period, inDirection, now),
            ),
            this.prisma.attendanceRecord.findMany({
                where: {
                    workspaceId,
                    userId,
                    markedAt: { gte: streakSince },
                    ...inDirection,
                },
                select: { markedAt: true },
            }),
        ])

        const entries = board.ranked.map((e) => ({
            userId: e.userId,
            name: e.name,
            checkins: e.checkins,
            rank: e.rank,
            isMe: e.userId === userId,
        }))

        const myEntry = board.ranked.find((e) => e.userId === userId)
        const me = {
            checkins: board.counts[userId] ?? 0,
            rank: myEntry ? myEntry.rank : null,
            streakWeeks: computeStreakWeeks(
                myRecords.map((r) => weekIndex(r.markedAt)),
                weekIndex(now),
            ),
            hidden: board.hiddenUserIds.includes(userId),
        }

        return { enabled: true, period, directionId, entries, me }
    }

    private async computeBoard(
        workspaceId: string,
        period: LeaderboardPeriod,
        inDirection: Prisma.AttendanceRecordWhereInput,
        now: Date,
    ): Promise<LeaderboardBoard> {
        const since = new Date(
            now.getTime() - (period === 'week' ? 7 : 30) * DAY_MS,
        )
        const [grouped, members] = await Promise.all([
            this.prisma.attendanceRecord.groupBy({
                by: ['userId'],
                where: { workspaceId, markedAt: { gte: since }, ...inDirection },
                _count: { _all: true },
            }),
            this.prisma.workspaceMember.findMany({
                where: { workspaceId, status: MemberStatus.ACTIVE },
                select: {
                    userId: true,
                    hideFromLeaderboard: true,
                    user: {
                        select: {
                            firstname: true,
                            lastname: true,
                        },
                    },
                },
            }),
        ])

        const counts: Record<string, number> = {}
        for (const g of grouped) counts[g.userId] = g._count._all

        const ranked = rankEntries(
            members
                .filter((m) => !m.hideFromLeaderboard)
                .map((m) => ({
                    userId: m.userId,
                    name: publicMemberName(m.user),
                    checkins: counts[m.userId] ?? 0,
                }))
                .filter((e) => e.checkins > 0),
        )

        return {
            ranked: ranked.map((e) => ({
                userId: e.userId,
                name: e.name,
                checkins: e.checkins,
                rank: e.rank,
            })),
            counts,
            hiddenUserIds: members
                .filter((m) => m.hideFromLeaderboard)
                .map((m) => m.userId),
        }
    }
}
