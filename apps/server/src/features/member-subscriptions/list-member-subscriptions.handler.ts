import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListMemberSubscriptionsFeature,
    ListMemberSubscriptionsFeatureResponse,
} from './list-member-subscriptions.feature'
import { serializeSubscription } from './schemas'

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
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Only workspace admins can view abonements',
        )

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: { id: true, subscriptionId: true },
        })
        if (!member) throw new NotFoundError({ message: 'Member not found' })

        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
            include: { plan: { select: { name: true } } },
            orderBy: { startDate: 'desc' },
        })

        const history = subs.map(serializeSubscription)
        const current =
            history.find((s) => s.id === member.subscriptionId) ?? null
        return { current, history }
    }
}
