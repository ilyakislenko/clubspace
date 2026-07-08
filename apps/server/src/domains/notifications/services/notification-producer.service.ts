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
    featureFlagSelect,
    toFeatureFlags,
} from '../../workspace/feature-flags'
import { NotificationCategoryKey } from './preferences.service'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// Event-driven notification producer. Feature handlers call this when
// something happens (a promotion, a published announcement); the scheduler
// keeps its own producers for time-based nudges. Every call is deduped on
// (kind, refId) via NotificationDispatchLog, so a retried handler ships the
// notification exactly once. Rows are created with `sent: false` — the
// push-delivery layer picks them up and respects the user's push settings.
@Injectable()
export class NotificationProducerService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    // Notify a single user once per (kind, refId). Returns false if already
    // sent or if the user opted out of `category`. The opt-out check runs
    // before claim() so it never burns the dedup token.
    async notifyUser(p: {
        userId: string
        kind: string
        refId: string
        topic: string
        message: string
        link?: string | null
        metadata?: Record<string, unknown>
        category?: NotificationCategoryKey
        // When set (with workspaceId), the push is suppressed if the club has
        // disabled that app section — a hidden section shouldn't ping members.
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
        if (!(await this.claim(p.kind, p.refId))) return false
        const created = await this.prisma.notification.create({
            data: {
                userId: p.userId,
                type: NotificationTypeEnum.PUSH,
                topic: p.topic,
                message: p.message,
                link: p.link ?? null,
                metadata: {
                    ...(p.metadata ?? {}),
                    kind: p.kind,
                } as Prisma.InputJsonValue,
                seen: false,
                sent: false,
            },
        })
        // Push the new row straight into the recipient's open inbox (delta),
        // shaped like the get-my-notifications list item.
        this.realtime.emitListDeltaUsers([p.userId], 'notifications', 'create', {
            id: created.id,
            topic: created.topic,
            message: created.message,
            link: created.link,
            type: created.type,
            seen: created.seen,
            metadata: created.metadata as Record<string, unknown> | null,
            createdAt: created.createdAt.toISOString(),
        })
        return true
    }

    // Fan out to every ACTIVE member of a workspace (minus an optional actor),
    // once per (kind, refId). Returns the recipient count.
    async notifyWorkspace(p: {
        workspaceId: string
        kind: string
        refId: string
        topic: string
        message: string
        metadata?: Record<string, unknown>
        excludeUserId?: string
        category?: NotificationCategoryKey
        // When set, the fan-out is suppressed if the club disabled that app
        // section (checked before claim() so a later re-enable can still fire).
        feature?: AppFeatureKey
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
        await this.prisma.notification.createMany({
            data: recipients.map((userId) => ({
                userId,
                type: NotificationTypeEnum.PUSH,
                topic: p.topic,
                message: p.message,
                link: null,
                metadata: {
                    ...(p.metadata ?? {}),
                    kind: p.kind,
                } as Prisma.InputJsonValue,
                seen: false,
                sent: false,
            })),
        })
        // Live-refresh every recipient's inbox.
        this.realtime.invalidateUsers(recipients, ['notifications'])
        return recipients.length
    }

    // Whether the workspace has this app section enabled. Fails OPEN (unknown
    // workspace → allowed) so a bad id never silently swallows notifications.
    private async featureEnabled(
        workspaceId: string,
        feature: AppFeatureKey,
    ): Promise<boolean> {
        const ws = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: featureFlagSelect,
        })
        return ws ? toFeatureFlags(ws)[feature] : true
    }

    // Whether a single user has `category` enabled. A missing prefs row means
    // defaults-on, so absence counts as enabled.
    private async categoryEnabled(
        userId: string,
        category: NotificationCategoryKey,
    ): Promise<boolean> {
        const prefs = await this.prisma.notificationPreferences.findUnique({
            where: { userId },
        })
        return prefs ? prefs[category] !== false : true
    }

    // Narrow a set of userIds to those who have NOT opted out of `category`.
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

    // INSERT-on-conflict-do-nothing dedup: true = we claimed it, false = a
    // prior/concurrent call already did.
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
