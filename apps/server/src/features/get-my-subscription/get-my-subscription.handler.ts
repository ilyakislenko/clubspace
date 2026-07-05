import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { serializeSubscription } from '../member-subscriptions/schemas'
import {
    GetMySubscriptionFeature,
    GetMySubscriptionFeatureResponse,
} from './get-my-subscription.feature'

@Feature(GetMySubscriptionFeature)
export class GetMySubscriptionHandler
    implements
        IFeatureHandler<
            GetMySubscriptionFeature,
            GetMySubscriptionFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMySubscriptionFeature) {
        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: { id: true, subscriptionId: true, accessUntil: true },
        })
        // Owner (or anyone without a member row) has no abonement — unlimited.
        if (!member) {
            return { current: null, history: [], accessUntil: null }
        }

        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
            include: { plan: { select: { name: true } } },
            orderBy: { startDate: 'desc' },
        })
        const history = subs.map(serializeSubscription)
        const current =
            history.find((s) => s.id === member.subscriptionId) ?? null

        return {
            current,
            history,
            accessUntil: member.accessUntil
                ? member.accessUntil.toISOString()
                : null,
        }
    }
}
