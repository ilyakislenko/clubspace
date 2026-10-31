import { Injectable, Logger } from '@nestjs/common'

import { localDateInTz } from '../../features/attendance/attendance-utils'
import { backfillLastAttendedAt } from '../../features/attendance/last-attended'
import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import {
    NotificationProducerService,
    type PushNotificationRow,
} from '../notifications/services/notification-producer.service'
import { isAwaitingFirstVisit } from '../subscriptions/subscription-status'
import { type DueClub, findClubsDue, localHourInTz } from './clubs-due'
import {
    claimDispatch,
    claimDispatchMany,
    releaseDispatch,
} from './dispatch-claims'

const DAY_MS = 24 * 60 * 60_000

// Club-local morning. Two hours so one missed run doesn't skip the day; the
// per-club-day claim keeps it to one pass.
export const DAILY_CLUB_LOCAL_HOURS = [10, 11]
const RUN_KIND = 'club.daily.run'

const INACTIVITY_DAYS = 14
const ACCESS_EXPIRY_LOOKAHEAD_DAYS = 3

const BACKFILL_KIND = 'backfill.last-attended'
const BACKFILL_REF = 'v1'

/**
 * Once a day per club, at club-local morning: inactivity nudges and access
 * expiry warnings. Every pass is scoped to one club and reads indexed
 * columns (WorkspaceMember.lastAttendedAt / accessUntil), instead of the old
 * every-minute aggregate over all attendance on the platform.
 */
@Injectable()
export class DailyClubService {
    private readonly logger = new Logger(DailyClubService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async run(now: Date = new Date()): Promise<{
        clubs: number
        failed: number
        inactivityNotified: number
        accessExpiryNotified: number
    }> {
        await this.backfillOnce()

        const clubs = await findClubsDue(this.prisma, (tz) =>
            DAILY_CLUB_LOCAL_HOURS.includes(localHourInTz(now, tz)),
        )
        const summary = {
            clubs: 0,
            failed: 0,
            inactivityNotified: 0,
            accessExpiryNotified: 0,
        }
        for (const club of clubs) {
            const refId = `${club.id}:${localDateInTz(now, club.timezone)}`
            if (!(await claimDispatch(this.prisma, RUN_KIND, refId))) continue
            summary.clubs += 1
            try {
                summary.inactivityNotified += await this.nudgeInactive(club, now)
                summary.accessExpiryNotified += await this.warnAccessExpiring(
                    club,
                    now,
                )
            } catch (err) {
                // Release so the next run retries; the per-member keys keep
                // anyone already notified from a second push. One club's
                // failure must not stop the others.
                summary.failed += 1
                await releaseDispatch(this.prisma, RUN_KIND, refId)
                this.logger.error(
                    `daily pass failed for club ${club.id}`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
        }
        return summary
    }

    // lastAttendedAt is maintained by the attendance handlers; rows that
    // predate the column are filled once from the attendance history.
    private async backfillOnce(): Promise<void> {
        if (!(await claimDispatch(this.prisma, BACKFILL_KIND, BACKFILL_REF))) {
            return
        }
        try {
            const updated = await backfillLastAttendedAt(this.prisma)
            this.logger.log(`lastAttendedAt backfilled for ${updated} member(s)`)
        } catch (err) {
            await releaseDispatch(this.prisma, BACKFILL_KIND, BACKFILL_REF)
            throw err
        }
    }

    // Members who have never attended are left alone — that's onboarding,
    // not churn. Deduped weekly.
    private async nudgeInactive(club: DueClub, now: Date): Promise<number> {
        const cutoff = new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS)
        const stale = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: club.id,
                status: MemberStatus.ACTIVE,
                lastAttendedAt: { lt: cutoff },
                OR: [{ accessUntil: null }, { accessUntil: { gt: now } }],
            },
            select: { userId: true, lastAttendedAt: true },
        })
        if (stale.length === 0) return 0

        const optedOut = await this.optedOut(
            stale.map((m) => m.userId),
            'inactivityEnabled',
        )
        const weekBucket = Math.floor(now.getTime() / (7 * DAY_MS))
        const candidates = stale
            .filter((m) => !optedOut.has(m.userId))
            .map((m) => ({
                ...m,
                refId: `${club.id}:${m.userId}:${weekBucket}`,
            }))
        const claimed = await this.claimUnsent('member.inactive', candidates)

        return this.notifications.writeMany(
            candidates
                .filter((m) => claimed.has(m.refId))
                .map(
                    (m): PushNotificationRow => ({
                        userId: m.userId,
                        topic: 'Давно вас не было',
                        message: `${club.name}: вы не отмечались на тренировках уже больше ${INACTIVITY_DAYS} дней. Ждём вас на тренировке!`,
                        link: null,
                        metadata: {
                            kind: 'member.inactive',
                            workspaceId: club.id,
                            lastAttendedAt: m.lastAttendedAt?.toISOString() ?? null,
                        },
                    }),
                ),
        )
    }

    // Owners have no member row, so this only targets granted members.
    private async warnAccessExpiring(club: DueClub, now: Date): Promise<number> {
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: club.id,
                status: MemberStatus.ACTIVE,
                accessUntil: {
                    gt: now,
                    lte: new Date(
                        now.getTime() + ACCESS_EXPIRY_LOOKAHEAD_DAYS * DAY_MS,
                    ),
                },
            },
            select: {
                id: true,
                userId: true,
                accessUntil: true,
                subscription: { select: { status: true, startDate: true } },
            },
        })
        if (members.length === 0) return 0

        const optedOut = await this.optedOut(
            members.map((m) => m.userId),
            'accessExpiringEnabled',
        )
        const candidates = members.flatMap((m) =>
            // Before the first visit the window is provisional — no warning.
            m.accessUntil &&
            !isAwaitingFirstVisit(m.subscription) &&
            !optedOut.has(m.userId)
                ? [
                      {
                          ...m,
                          accessUntil: m.accessUntil,
                          // A new accessUntil re-arms a fresh warning.
                          refId: `${m.id}:${m.accessUntil.toISOString().slice(0, 10)}`,
                      },
                  ]
                : [],
        )
        const claimed = await this.claimUnsent('access.expiring', candidates)

        return this.notifications.writeMany(
            candidates
                .filter((m) => claimed.has(m.refId))
                .map((m): PushNotificationRow => {
                    const daysLeft = Math.max(
                        0,
                        Math.ceil(
                            (m.accessUntil.getTime() - now.getTime()) / DAY_MS,
                        ),
                    )
                    return {
                        userId: m.userId,
                        topic: 'Доступ скоро истекает',
                        message: `${club.name}: доступ истекает ${formatRuDate(
                            m.accessUntil,
                            club.timezone,
                        )}${
                            daysLeft > 0 ? ` (через ${daysLeft} дн.)` : ' (сегодня)'
                        }. Продлите, чтобы не потерять доступ к приложению клуба.`,
                        link: null,
                        metadata: {
                            kind: 'access.expiring',
                            workspaceId: club.id,
                            memberId: m.id,
                            accessUntil: m.accessUntil.toISOString(),
                        },
                    }
                }),
        )
    }

    // No prefs row means enabled, so fetch only explicit opt-outs.
    private async optedOut(
        userIds: string[],
        category: 'inactivityEnabled' | 'accessExpiringEnabled',
    ): Promise<Set<string>> {
        const rows = await this.prisma.notificationPreferences.findMany({
            where: { userId: { in: userIds }, [category]: false },
            select: { userId: true },
        })
        return new Set(rows.map((r) => r.userId))
    }

    // One read of the log skips what already went out (the common case on a
    // second run), then one INSERT claims the rest.
    private async claimUnsent(
        kind: string,
        candidates: { refId: string }[],
    ): Promise<Set<string>> {
        if (candidates.length === 0) return new Set()
        const logged = await this.prisma.notificationDispatchLog.findMany({
            where: { kind, refId: { in: candidates.map((c) => c.refId) } },
            select: { refId: true },
        })
        const sent = new Set(logged.map((l) => l.refId))
        return claimDispatchMany(
            this.prisma,
            kind,
            candidates.map((c) => c.refId).filter((r) => !sent.has(r)),
        )
    }
}
