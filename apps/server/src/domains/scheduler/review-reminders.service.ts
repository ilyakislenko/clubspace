import { Injectable, Logger } from '@nestjs/common'

import { localDateInTz } from '../../features/attendance/attendance-utils'
import { newCardDueAt } from '../../features/bookmark-reviews/review-scheduler'
import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import { pluralRu } from '../../shared/utils/plural-ru'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { CourseAccessService } from '../playlist/services/course-access.service'
import { type DueClub, findClubsDue, localHourInTz } from './clubs-due'
import { claimDispatch, releaseDispatch } from './dispatch-claims'

// Club-local evening. Two hours so one missed run doesn't skip the day; the
// per-club-day claim keeps it to one pass.
export const REVIEW_REMINDER_LOCAL_HOURS = [18, 19]
export const REVIEW_REMINDER_RUN_KIND = 'review.reminders.run'
export const REVIEW_REMINDER_KIND = 'review.due'

export type ReminderBookmark = {
    userId: string
    videoId: string
    createdAt: Date
    review: { dueAt: Date; lastReviewedAt: Date } | null
}

export type ReminderCandidate = { userId: string; dueVideoIds: string[] }

/**
 * Who gets «Пора повторить» today: active members (and the owner) with cards
 * due now — the same rule as «Повторение» (a never-reviewed bookmark is due a
 * day after it was saved) — who haven't reviewed anything today, club time,
 * and haven't opted out. Each due card is listed by its video so the caller
 * can drop the ones the member may no longer watch.
 */
export const selectReviewReminders = (
    bookmarks: readonly ReminderBookmark[],
    p: {
        activeUserIds: ReadonlySet<string>
        optedOutUserIds: ReadonlySet<string>
        now: Date
        timezone: string
    },
): ReminderCandidate[] => {
    const today = localDateInTz(p.now, p.timezone)
    const reviewedToday = new Set<string>()
    const due = new Map<string, string[]>()
    for (const b of bookmarks) {
        if (!p.activeUserIds.has(b.userId) || p.optedOutUserIds.has(b.userId)) continue
        if (b.review && localDateInTz(b.review.lastReviewedAt, p.timezone) === today) {
            reviewedToday.add(b.userId)
        }
        const dueAt = b.review?.dueAt ?? newCardDueAt(b.createdAt)
        if (dueAt.getTime() > p.now.getTime()) continue
        due.set(b.userId, [...(due.get(b.userId) ?? []), b.videoId])
    }
    return [...due]
        .filter(([userId]) => !reviewedToday.has(userId))
        .map(([userId, dueVideoIds]) => ({ userId, dueVideoIds }))
}

/** «Пора повторить 5 карточек» (accusative after the verb — no colon). */
export const reviewReminderMessage = (count: number): string =>
    `Пора повторить ${count} ${pluralRu(count, 'карточку', 'карточки', 'карточек')}`

/**
 * «Повторение»: once a day, at club-local evening, a push + inbox entry for
 * members whose bookmark cards are due and who haven't reviewed today. At most
 * one per member per club day (the dispatch log); off with
 * NotificationPreferences.reviewRemindersEnabled, a muted club or videos off.
 */
@Injectable()
export class ReviewRemindersService {
    private readonly logger = new Logger(ReviewRemindersService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async run(now: Date = new Date()): Promise<{ clubs: number; failed: number; sent: number }> {
        const clubs = await findClubsDue(this.prisma, (tz) =>
            REVIEW_REMINDER_LOCAL_HOURS.includes(localHourInTz(now, tz)),
        )
        const summary = { clubs: 0, failed: 0, sent: 0 }
        for (const club of clubs) {
            const today = localDateInTz(now, club.timezone)
            const runRef = `${club.id}:${today}`
            if (!(await claimDispatch(this.prisma, REVIEW_REMINDER_RUN_KIND, runRef))) continue
            summary.clubs += 1
            try {
                summary.sent += await this.remindClub(club, today, now)
            } catch (e) {
                // Free the club-day so the next run retries; the per-member
                // keys keep anyone already reminded from a second push.
                summary.failed += 1
                await releaseDispatch(this.prisma, REVIEW_REMINDER_RUN_KIND, runRef)
                this.logger.error(`review reminders failed for ${club.id}: ${String(e)}`)
            }
        }
        return summary
    }

    private async remindClub(club: DueClub, today: string, now: Date): Promise<number> {
        // Videos off for the club (or not entitled): no «Повторение» to open.
        const videosOn = await this.notifications.canNotifyUser({
            userId: club.ownerId,
            workspaceId: club.id,
            feature: 'videos',
        })
        if (!videosOn) return 0

        const bookmarks = await this.prisma.videoBookmark.findMany({
            where: { workspaceId: club.id, deletedAt: null },
            select: {
                userId: true,
                videoId: true,
                createdAt: true,
                review: { select: { dueAt: true, lastReviewedAt: true } },
            },
        })
        if (bookmarks.length === 0) return 0
        const userIds = [...new Set(bookmarks.map((b) => b.userId))]
        const [members, optedOut] = await Promise.all([
            this.prisma.workspaceMember.findMany({
                where: {
                    workspaceId: club.id,
                    userId: { in: userIds },
                    status: MemberStatus.ACTIVE,
                    OR: [{ accessUntil: null }, { accessUntil: { gt: now } }],
                },
                select: { userId: true },
            }),
            this.prisma.notificationPreferences.findMany({
                where: { userId: { in: userIds }, reviewRemindersEnabled: false },
                select: { userId: true },
            }),
        ])
        // The owner has no WorkspaceMember row.
        const active = new Set([...members.map((m) => m.userId), club.ownerId])
        const candidates = selectReviewReminders(bookmarks, {
            activeUserIds: active,
            optedOutUserIds: new Set(optedOut.map((o) => o.userId)),
            now,
            timezone: club.timezone,
        })

        let sent = 0
        for (const c of candidates) {
            // Same count as the app's «Повторение»: cards of lessons still open.
            const watchable = await this.courseAccess.watchableVideoIds(
                club.id,
                c.userId,
                c.dueVideoIds,
            )
            const count = c.dueVideoIds.filter((id) => watchable.has(id)).length
            if (count === 0) continue
            const delivered = await this.notifications.notifyUser({
                userId: c.userId,
                kind: REVIEW_REMINDER_KIND,
                refId: `${club.id}:${c.userId}:${today}`,
                topic: club.name,
                message: reviewReminderMessage(count),
                category: 'reviewRemindersEnabled',
                workspaceId: club.id,
                metadata: { workspaceId: club.id, count },
            })
            if (delivered) sent += 1
        }
        return sent
    }
}
