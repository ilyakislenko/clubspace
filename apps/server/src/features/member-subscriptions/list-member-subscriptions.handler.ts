import { Feature, IFeatureHandler } from '@shelfjs/features'

import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListMemberSubscriptionsFeature,
    ListMemberSubscriptionsFeatureResponse,
} from './list-member-subscriptions.feature'
import {
    serializeSubscription,
    serializeSubscriptionFreeze,
} from './schemas'

@Feature(ListMemberSubscriptionsFeature)
export class ListMemberSubscriptionsHandler
    implements
        IFeatureHandler<
            ListMemberSubscriptionsFeature,
            ListMemberSubscriptionsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListMemberSubscriptionsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.rbac.assertCanReadMember(ctx, f.userId)

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: { id: true, subscriptionId: true },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
            include: { plan: { select: { name: true } } },
            orderBy: { startDate: 'desc' },
        })

        const freezes = await this.prisma.subscriptionFreeze.findMany({
            where: { workspaceId: f.workspaceId, userId: f.userId },
            orderBy: { fromDate: 'desc' },
        })

        const history = subs.map(serializeSubscription)
        // The pointer outlives a pack that simply ran out of days, so check it
        // is still usable — otherwise an expired pack reads as "current, active".
        const currentRow = subs.find((s) => s.id === member.subscriptionId)
        const current =
            currentRow && isSubscriptionUsable(currentRow, new Date())
                ? serializeSubscription(currentRow)
                : null
        return {
            current,
            history,
            freezes: freezes.map(serializeSubscriptionFreeze),
        }
    }
}
