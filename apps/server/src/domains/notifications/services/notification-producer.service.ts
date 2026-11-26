import { Injectable } from '@nestjs/common'

import {
    MemberStatus,
    NotificationTypeEnum,
    Prisma,
    PrismaService,
} from '../../../infrastructure/prisma'
import { RealtimeEmitter } from '../../realtime/realtime-emitter.service'
import {
    type AppFeatureKey,
    appFeatureSelect,
    toAppFeatureFlags,
} from '../../workspace/feature-flags'
import { NotificationCategoryKey } from './preferences.service'
import { PushQueueService } from './push-queue.service'
import { filterMuted, isMuteExempt, isMutedFor } from '../notification-mute'
import { loadGuardianRoutes, routeToGuardians } from '../guardian-routing'
import { filterRoutedRows } from '../recipient-gates'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// Foreign-key violation: on a notification row that can only be its user —
// the recipient was deleted between routing and the INSERT. Background
// producers (a check-in follow-up, a scheduler job) race account deletion.
const isP2003 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2003'

// One PUSH notification row to write; metadata always carries its kind.
export type PushNotificationRow = {
    userId: string
    topic: string
    message: string
    link?: string | null
    metadata: { kind: string; workspaceId?: string } & Record<string, unknown>
    // The opt-out category, checked against a guardian who gets the row for a
    // child (filterRoutedRows); not persisted. Callers pre-filter adults.
    category?: NotificationCategoryKey
}

// Writes PUSH notification rows and hands them to the push queue. Event-driven
// callers use notifyUser/notifyWorkspace, deduped on (kind, refId) via
// NotificationDispatchLog so a retried handler ships once; the scheduler jobs
// claim their own dedupe keys in bulk and call writeMany directly.
@Injectable()
export class NotificationProducerService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
        private readonly push: PushQueueService,
    ) {}

    // One INSERT for the whole batch, then one enqueue. Returns rows written.
    // Two mutes, either silences a child's row (non-critical kinds): the
    // child's own membership mute (set by a guardian from the child's
    // profile) is checked first, on the addressed user; rows addressed to a
    // dependent then go to its guardians, and each guardian copy is checked
    // against that guardian — their category opt-out and their own mute of
    // the club (filterRoutedRows).
    async writeMany(input: PushNotificationRow[]): Promise<number> {
        const unmuted = await filterMuted(this.prisma, input)
        if (unmuted.length === 0) return 0
        const routes = await loadGuardianRoutes(
            this.prisma,
            unmuted.map((r) => r.userId),
        )
        const rows = await filterRoutedRows(
            this.prisma,
            routeToGuardians(unmuted, routes),
        )
        if (rows.length === 0) return 0
        const created = await this.insertSkippingDeleted(rows)
        await this.push.enqueue(created.map((c) => c.id))
        const guardianIds = [
            ...new Set(
                rows.filter((r) => typeof r.metadata.dependentId === 'string').map((r) => r.userId),
            ),
        ]
        if (guardianIds.length > 0) {
            // Callers refresh the inboxes of the users they addressed; the
            // guardians who got a dependent's rows need it too.
            this.realtime.invalidateUsers(guardianIds, ['notifications'])
        }
        return created.length
    }

    // A deleted recipient gets no notification instead of failing the whole
    // batch: on a foreign-key violation, retry once with the users that still
    // exist.
    private async insertSkippingDeleted(
        rows: PushNotificationRow[],
    ): Promise<{ id: string }[]> {
        const insert = (batch: PushNotificationRow[]) =>
            this.prisma.notification.createManyAndReturn({
                data: batch.map((r) => ({
                    userId: r.userId,
                    type: NotificationTypeEnum.PUSH,
                    topic: r.topic,
                    message: r.message,
                    link: r.link ?? null,
                    metadata: r.metadata as Prisma.InputJsonValue,
                    seen: false,
                    sent: false,
                })),
                select: { id: true },
            })
        try {
            return await insert(rows)
        } catch (e) {
            if (!isP2003(e)) throw e
        }
        const alive = await this.prisma.user.findMany({
            where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
            select: { id: true },
        })
        const ids = new Set(alive.map((u) => u.id))
        const kept = rows.filter((r) => ids.has(r.userId))
        return kept.length > 0 ? insert(kept) : []
    }

    // The club-feature and per-user opt-out gates of notifyUser, on their own, so
    // a caller can skip expensive message building for a suppressed user.
    async canNotifyUser(p: {
        userId: string
        category?: NotificationCategoryKey
        workspaceId?: string
        feature?: AppFeatureKey
    }): Promise<boolean> {
        if (
            p.feature &&
            p.workspaceId &&
            !(await this.featureEnabled(p.workspaceId, p.feature))
        ) {
            return false
        }
        if (p.category && !(await this.categoryEnabled(p.userId, p.category))) {
            return false
        }
        return true
    }

    // The opt-out check runs before claim() so it never burns the dedup token.
    // A guardian's copy of a child's notice is gated after routing (their
    // category and own club mute); a gated copy is not retried later.
    async notifyUser(p: {
        userId: string
        kind: string
        refId: string
        topic: string
        message: string
        link?: string | null
        metadata?: Record<string, unknown>
        category?: NotificationCategoryKey
        // Suppressed if the club disabled that app section.
        workspaceId?: string
        feature?: AppFeatureKey
    }): Promise<boolean> {
        if (!(await this.canNotifyUser(p))) return false
        if (
            await isMutedFor(this.prisma, {
                userId: p.userId,
                workspaceId: p.workspaceId ?? p.metadata?.workspaceId,
                kind: p.kind,
            })
        ) {
            return false
        }
        if (!(await this.claim(p.kind, p.refId))) return false
        const routes = await loadGuardianRoutes(this.prisma, [p.userId])
        const rows = await filterRoutedRows(
            this.prisma,
            routeToGuardians(
                [
                    {
                        userId: p.userId,
                        topic: p.topic,
                        message: p.message,
                        category: p.category,
                        metadata: {
                            ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}),
                            ...(p.metadata ?? {}),
                            kind: p.kind,
                        },
                    },
                ],
                routes,
            ),
        )
        let written = 0
        for (const row of rows) {
            let created
            try {
                created = await this.prisma.notification.create({
                    data: {
                        userId: row.userId,
                        type: NotificationTypeEnum.PUSH,
                        topic: row.topic,
                        message: row.message,
                        link: p.link ?? null,
                        metadata: row.metadata as Prisma.InputJsonValue,
                        seen: false,
                        sent: false,
                    },
                })
            } catch (e) {
                // The recipient was deleted after routing: nothing to notify.
                if (isP2003(e)) continue
                throw e
            }
            written++
            await this.push.enqueue([created.id])
            this.realtime.emitListDeltaUsers(
                [row.userId],
                'notifications',
                'create',
                {
                    id: created.id,
                    topic: created.topic,
                    message: created.message,
                    link: created.link,
                    type: created.type,
                    seen: created.seen,
                    metadata: created.metadata as Record<string, unknown> | null,
                    createdAt: created.createdAt.toISOString(),
                },
            )
        }
        return written > 0
    }

    async notifyWorkspace(p: {
        workspaceId: string
        kind: string
        refId: string
        topic: string
        message: string
        metadata?: Record<string, unknown>
        excludeUserId?: string
        category?: NotificationCategoryKey
        // Checked before claim() so a later re-enable can still fire.
        feature?: AppFeatureKey
        memberWhere?: Prisma.WorkspaceMemberWhereInput
    }): Promise<number> {
        if (
            p.feature &&
            !(await this.featureEnabled(p.workspaceId, p.feature))
        ) {
            return 0
        }
        if (!(await this.claim(p.kind, p.refId))) return 0
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: p.workspaceId,
                status: MemberStatus.ACTIVE,
                ...(p.excludeUserId ? { userId: { not: p.excludeUserId } } : {}),
                ...(p.memberWhere ?? {}),
                // Members who muted this club skip its non-critical kinds.
                ...(isMuteExempt(p.kind) ? {} : { notificationsMuted: false }),
            },
            select: { userId: true },
        })
        if (members.length === 0) return 0
        const recipients = p.category
            ? await this.filterOptedIn(
                  members.map((m) => m.userId),
                  p.category,
              )
            : members.map((m) => m.userId)
        if (recipients.length === 0) return 0
        await this.writeMany(
            recipients.map((userId) => ({
                userId,
                topic: p.topic,
                message: p.message,
                category: p.category,
                metadata: {
                    workspaceId: p.workspaceId,
                    ...(p.metadata ?? {}),
                    kind: p.kind,
                },
            })),
        )
        this.realtime.invalidateUsers(recipients, ['notifications'])
        return recipients.length
    }

    // Fails OPEN (unknown workspace → allowed) so a bad id never silently
    // swallows notifications.
    private async featureEnabled(
        workspaceId: string,
        feature: AppFeatureKey,
    ): Promise<boolean> {
        const ws = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: appFeatureSelect,
        })
        return ws ? toAppFeatureFlags(ws)[feature] : true
    }

    // A missing prefs row means defaults-on.
    private async categoryEnabled(
        userId: string,
        category: NotificationCategoryKey,
    ): Promise<boolean> {
        const prefs = await this.prisma.notificationPreferences.findUnique({
            where: { userId },
        })
        return prefs ? prefs[category] !== false : true
    }

    // Users without a prefs row are defaults-on and therefore kept.
    private async filterOptedIn(
        userIds: string[],
        category: NotificationCategoryKey,
    ): Promise<string[]> {
        const optedOut = new Set(
            (
                await this.prisma.notificationPreferences.findMany({
                    where: {
                        userId: { in: userIds },
                        [category]: false,
                    } as Prisma.NotificationPreferencesWhereInput,
                    select: { userId: true },
                })
            ).map((r) => r.userId),
        )
        return userIds.filter((id) => !optedOut.has(id))
    }

    // true = we claimed it, false = a prior/concurrent call already did.
    private async claim(kind: string, refId: string): Promise<boolean> {
        try {
            await this.prisma.notificationDispatchLog.create({
                data: { kind, refId },
            })
            return true
        } catch (e) {
            if (isP2002(e)) return false
            throw e
        }
    }
}
