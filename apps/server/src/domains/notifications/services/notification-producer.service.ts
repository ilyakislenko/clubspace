import { Injectable } from '@nestjs/common'

import {
    MemberStatus,
    NotificationTypeEnum,
    Prisma,
    PrismaService,
} from '../../../infrastructure/prisma'

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
    constructor(private readonly prisma: PrismaService) {}

    // Notify a single user once per (kind, refId). Returns false if already sent.
    async notifyUser(p: {
        userId: string
        kind: string
        refId: string
        topic: string
        message: string
        link?: string | null
        metadata?: Record<string, unknown>
    }): Promise<boolean> {
        if (!(await this.claim(p.kind, p.refId))) return false
        await this.prisma.notification.create({
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
    }): Promise<number> {
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
        await this.prisma.notification.createMany({
            data: members.map((m) => ({
                userId: m.userId,
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
        return members.length
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
