import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import { PrismaService } from '../../../infrastructure/prisma'
import { RolesEnum } from '../../../shared/interfaces/shared.intefaces'
import { AuditService } from '../../audit/services/audit.service'
import { RealtimeEmitter } from '../../realtime/realtime-emitter.service'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// The store-review account must land in a club with real content: an empty
// "no club yet" screen gets the app rejected for "incomplete functionality".
// With STORE_REVIEW_WORKSPACE_KEY set, every review sign-in makes the reviewer
// an ACTIVE plain student of that demo club — creating the membership, or
// lifting a pending/blocked/suspended one and an expired access window. A
// membership that already gives access is left alone, so repeat sign-ins write
// nothing. The role is never touched: sign-in has already refused a reviewer
// with any role above student.
@Injectable()
export class StoreReviewMembershipService {
    private readonly logger = new Logger(StoreReviewMembershipService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    // Never throws: the review sign-in must not fail because of the demo club.
    async ensureDemoMembership(userId: string): Promise<void> {
        const key = environment.storeReview.workspaceKey?.trim()
        if (!key) return
        try {
            await this.ensure(userId, key)
        } catch (error) {
            this.logger.warn(
                `Failed to give the store review account its demo club: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }

    private async ensure(userId: string, key: string): Promise<void> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { key },
            select: { id: true, ownerId: true, isActive: true },
        })
        if (!workspace || !workspace.isActive) {
            this.logger.warn(
                `STORE_REVIEW_WORKSPACE_KEY "${key}" matches no active club`,
            )
            return
        }
        // The owner has no member row; sign-in refuses owners anyway.
        if (workspace.ownerId === userId) return

        const existing = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId: workspace.id },
            },
            select: { id: true, status: true, accessUntil: true },
        })
        const now = new Date()
        const accessExpired =
            !!existing?.accessUntil && existing.accessUntil < now

        if (existing?.status === 'ACTIVE' && !accessExpired) return

        if (existing) {
            await this.prisma.workspaceMember.update({
                where: { id: existing.id },
                data: {
                    status: 'ACTIVE',
                    ...(accessExpired ? { accessUntil: null } : {}),
                },
            })
            await this.recordGrant({
                userId,
                workspaceId: workspace.id,
                membershipId: existing.id,
                metadata: {
                    change: 'reactivated',
                    previousStatus: existing.status,
                    accessUntilCleared: accessExpired,
                },
            })
            return
        }

        const role = await this.prisma.role.findUnique({
            where: { name: RolesEnum.USER.toLowerCase() },
            select: { id: true },
        })
        if (!role) {
            this.logger.warn('The student role is missing; demo club skipped')
            return
        }

        let membershipId: string
        try {
            const created = await this.prisma.workspaceMember.create({
                data: {
                    userId,
                    workspaceId: workspace.id,
                    roleId: role.id,
                    status: 'ACTIVE',
                },
                select: { id: true },
            })
            membershipId = created.id
        } catch (error) {
            // A concurrent review sign-in created it first and audits it.
            if (isP2002(error)) return
            throw error
        }
        await this.recordGrant({
            userId,
            workspaceId: workspace.id,
            membershipId,
            metadata: { change: 'created' },
        })
    }

    private async recordGrant(p: {
        userId: string
        workspaceId: string
        membershipId: string
        metadata: Record<string, unknown>
    }): Promise<void> {
        this.realtime.invalidate(p.workspaceId, ['members'])
        await this.audit.record({
            action: 'member.grantStoreReviewAccess',
            targetType: 'member',
            targetId: p.membershipId,
            workspaceId: p.workspaceId,
            actorId: p.userId,
            metadata: p.metadata,
        })
    }
}
