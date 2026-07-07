import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    MarkRecordsFeature,
    MarkRecordsFeatureResponse,
} from './mark-records.feature'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'

@Feature(MarkRecordsFeature)
export class MarkRecordsHandler
    implements IFeatureHandler<MarkRecordsFeature, MarkRecordsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: MarkRecordsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )

        const ids = [...new Set(f.payload.userIds)]

        // (1) Validate ACTIVE membership; the owner is allowed with no member row.
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'ACTIVE',
                userId: { in: ids },
            },
            select: { userId: true },
        })
        const allowed = new Set(members.map((m) => m.userId))
        if (workspace?.ownerId) allowed.add(workspace.ownerId)
        const unknown = ids.filter((id) => !allowed.has(id))
        if (unknown.length) {
            throw new BadRequestError({
                message: `Not active workspace members: ${unknown.join(', ')}`,
            })
        }

        // (2) isGuest per user (group sessions only; null for events).
        let guestOf: (userId: string) => boolean | null = () => null
        if (session.groupId) {
            const gm = await this.prisma.groupMember.findMany({
                where: { groupId: session.groupId, userId: { in: ids } },
                select: { userId: true },
            })
            const inGroup = new Set(gm.map((g) => g.userId))
            guestOf = (userId: string) => !inGroup.has(userId)
        }

        // (3) Which of these are NEW marks (not already recorded)? Only a new
        // mark consumes a class from the member's pack — a re-mark must not.
        const existing = await this.prisma.attendanceRecord.findMany({
            where: { sessionId: session.id, userId: { in: ids } },
            select: { userId: true },
        })
        const already = new Set(existing.map((r) => r.userId))
        const newIds = ids.filter((id) => !already.has(id))

        await this.prisma.$transaction(async (tx) => {
            // Insert; a re-mark is a no-op (skipDuplicates).
            await tx.attendanceRecord.createMany({
                data: ids.map((userId) => ({
                    sessionId: session.id,
                    workspaceId: f.workspaceId,
                    userId,
                    isGuest: guestOf(userId),
                    markedById: f.invokerUserId,
                })),
                skipDuplicates: true,
            })

            if (newIds.length === 0) return
            // Decrement the current class-pack subscription of each newly-marked
            // member by one, clamped at 0 (running out never blocks access;
            // time-only subs have classesRemaining = null and are skipped).
            const marked = await tx.workspaceMember.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    userId: { in: newIds },
                    subscriptionId: { not: null },
                },
                select: { subscriptionId: true },
            })
            const subIds = marked
                .map((m) => m.subscriptionId)
                .filter((id): id is string => Boolean(id))
            if (subIds.length > 0) {
                await tx.subscription.updateMany({
                    where: { id: { in: subIds }, classesRemaining: { gt: 0 } },
                    data: { classesRemaining: { decrement: 1 } },
                })
            }
        })

        // Live-refresh members' attendance, the leaderboard, and — since a pack
        // balance changed — their subscription screen.
        this.realtime.invalidate(f.workspaceId, [
            'attendance',
            'leaderboard',
            'subscription',
        ])

        return buildRoster(this.prisma, session)
    }
}
