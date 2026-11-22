import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadAutopayAbonements } from '../../domains/autopay/autopay-anchor'
import { anchorCancelledByClub } from '../../domains/autopay/autopay-rules'
import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { scopeDirectionIds } from '../../domains/subscriptions/current-subscriptions'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CancelSubscriptionFeature,
    CancelSubscriptionFeatureResponse,
} from './cancel-subscription.feature'
import { serializeSubscription } from './schemas'

@Feature(CancelSubscriptionFeature)
export class CancelSubscriptionHandler
    implements
        IFeatureHandler<
            CancelSubscriptionFeature,
            CancelSubscriptionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
        private readonly realtime: RealtimeEmitter,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async execute(f: CancelSubscriptionFeature) {
        await assertSportLead(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Снимать абонементы может только администратор клуба',
        )

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const sub = await this.prisma.subscription.findFirst({
            where: {
                id: f.subscriptionId,
                workspaceId: f.workspaceId,
                workspaceMemberId: member.id,
            },
            select: { id: true },
        })
        if (!sub) throw new NotFoundError({ message: 'Абонемент не найден' })

        const updated = await this.subscriptions.cancel({
            workspaceId: f.workspaceId,
            subscriptionId: sub.id,
        })
        await this.stopOrphanedAutopays(f.workspaceId, f.userId, member.id)

        this.realtime.invalidate(f.workspaceId, [
            'subscription',
            'freeze-requests',
            'requests',
        ])

        return serializeSubscription(updated)
    }

    // The club cancelled the abonement autopay would renew and nothing of
    // that scope is current: there is nothing left to renew, so the member's
    // agreement on it stops (SYSTEM, with a notice). The hourly pass checks
    // the same as a safety net (docs/design/2026-11-15-member-autopay.md §3.5).
    private async stopOrphanedAutopays(
        workspaceId: string,
        userId: string,
        workspaceMemberId: string,
    ) {
        const live = await this.prisma.memberAutopay.findMany({
            where: { workspaceId, userId, status: { in: ['ACTIVE', 'NEEDS_ACTION'] } },
            select: { id: true, plan: { select: { directions: { select: { directionId: true } } } } },
        })
        if (live.length === 0) return
        const now = new Date()
        const subs = await loadAutopayAbonements(this.prisma, { workspaceMemberId, now })
        for (const a of live) {
            if (a.plan && !anchorCancelledByClub(subs, scopeDirectionIds(a.plan), now)) continue
            await this.autopay.cancel({
                id: a.id,
                source: 'SYSTEM',
                reason: 'абонемент отменён клубом',
                now,
            })
        }
    }
}
