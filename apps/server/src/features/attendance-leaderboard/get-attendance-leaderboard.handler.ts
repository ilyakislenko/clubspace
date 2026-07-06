import { Feature, IFeatureHandler } from '@shelfjs/features'

import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import {
    GetAttendanceLeaderboardFeature,
    GetAttendanceLeaderboardFeatureResponse,
    LeaderboardPeriod,
} from './get-attendance-leaderboard.feature'
import {
    computeStreakWeeks,
    rankEntries,
    weekIndex,
} from './leaderboard-math'

const DAY_MS = 24 * 60 * 60 * 1000
const STREAK_LOOKBACK_WEEKS = 12

const memberName = (u: {
    firstname: string | null
    lastname: string | null
    email: string
}): string =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || u.email

// Attendance leaderboard for one workspace + period. Any member reads it
// (owner included); a club-off switch or a member opt-out narrows what's
// shown. Ranking is over ACTIVE members only, so guests and removed members
// never surface on the board.
@Feature(GetAttendanceLeaderboardFeature)
export class GetAttendanceLeaderboardHandler
    implements
        IFeatureHandler<
            GetAttendanceLeaderboardFeature,
            GetAttendanceLeaderboardFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        workspaceId,
        userId,
        payload,
    }: GetAttendanceLeaderboardFeature) {
        const period: LeaderboardPeriod = payload.period ?? 'month'
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
            return { enabled: false, period, entries: [], me: emptyMe }
        }

        const now = new Date()
        const since = new Date(
            now.getTime() - (period === 'week' ? 7 : 30) * DAY_MS,
        )
        const streakSince = new Date(
            now.getTime() - STREAK_LOOKBACK_WEEKS * 7 * DAY_MS,
        )

        const [grouped, members, myRecords] = await Promise.all([
            this.prisma.attendanceRecord.groupBy({
                by: ['userId'],
                where: { workspaceId, markedAt: { gte: since } },
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
                            email: true,
                        },
                    },
                },
            }),
            this.prisma.attendanceRecord.findMany({
                where: {
                    workspaceId,
                    userId,
                    markedAt: { gte: streakSince },
                },
                select: { markedAt: true },
            }),
        ])

        const countByUser = new Map(
            grouped.map((g) => [g.userId, g._count._all]),
        )

        const ranked = rankEntries(
            members
                .filter((m) => !m.hideFromLeaderboard)
                .map((m) => ({
                    userId: m.userId,
                    name: memberName(m.user),
                    checkins: countByUser.get(m.userId) ?? 0,
                }))
                .filter((e) => e.checkins > 0),
        )

        const entries = ranked.map((e) => ({
            userId: e.userId,
            name: e.name,
            checkins: e.checkins,
            rank: e.rank,
            isMe: e.userId === userId,
        }))

        const myMember = members.find((m) => m.userId === userId)
        const myEntry = ranked.find((e) => e.userId === userId)
        const me = {
            checkins: countByUser.get(userId) ?? 0,
            rank: myEntry ? myEntry.rank : null,
            streakWeeks: computeStreakWeeks(
                myRecords.map((r) => weekIndex(r.markedAt)),
                weekIndex(now),
            ),
            hidden: myMember?.hideFromLeaderboard ?? false,
        }

        return { enabled: true, period, entries, me }
    }
}
