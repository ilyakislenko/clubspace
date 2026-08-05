import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
    ) {}

    async execute(f: CancelSubscriptionFeature) {
        await assertWorkspaceAdmin(
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

        this.realtime.invalidate(f.workspaceId, ['subscription'])

        return serializeSubscription(updated)
    }
}
