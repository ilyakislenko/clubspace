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
import { PushQueueService } from './push-queue.service'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// One PUSH notification row to write; metadata always carries its kind.
export type PushNotificationRow = {
    userId: string
    topic: string
    message: string
    link?: string | null
    metadata: { kind: string; workspaceId?: string } & Record<string, unknown>
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
    async writeMany(rows: PushNotificationRow[]): Promise<number> {
        if (rows.length === 0) return 0
        const created = await this.prisma.notification.createManyAndReturn({
            data: rows.map((r) => ({
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
        await this.push.enqueue(created.map((c) => c.id))
        return created.length
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
        if (!(await this.claim(p.kind, p.refId))) return false
        const created = await this.prisma.notification.create({
            data: {
                userId: p.userId,
                type: NotificationTypeEnum.PUSH,
                topic: p.topic,
                message: p.message,
                link: p.link ?? null,
                metadata: {
                    ...(p.workspaceId ? { workspaceId: p.workspaceId } : {}),
                    ...(p.metadata ?? {}),
                    kind: p.kind,
                } as Prisma.InputJsonValue,
                seen: false,
                sent: false,
            },
        })
        await this.push.enqueue([created.id])
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
            select: featureFlagSelect,
        })
        return ws ? toFeatureFlags(ws)[feature] : true
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
