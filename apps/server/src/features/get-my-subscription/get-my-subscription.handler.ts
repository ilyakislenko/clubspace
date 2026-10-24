import { Feature, IFeatureHandler } from '@shelfjs/features'

import { findOpenFreeze } from '../../domains/subscriptions/services/subscription-freeze.service'
import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    serializeSubscription,
    serializeSubscriptionFreeze,
} from '../member-subscriptions/schemas'
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
            select: {
                id: true,
                subscriptionId: true,
                accessUntil: true,
                workspace: { select: { timezone: true } },
            },
        })
        // Owner (or anyone without a member row) has no abonement — unlimited.
        if (!member) {
            return { current: null, history: [], accessUntil: null, freeze: null }
        }

        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
            include: { plan: { select: { name: true } } },
            orderBy: { startDate: 'desc' },
        })
        const history = subs.map(serializeSubscription)
        // The membership's pointer outlives the row it points at — a pack that
        // ran out of days stays linked — so "current" has to be checked, not
        // assumed. Otherwise the member's own screen shows an expired abonement
        // as if it were live (and its leftover classes as if they were
        // spendable). History keeps every row, live or not.
        const currentRow = subs.find((s) => s.id === member.subscriptionId)
        const current = isSubscriptionUsable(currentRow)
            ? (history.find((s) => s.id === member.subscriptionId) ?? null)
            : null

        const openFreeze = current
            ? await findOpenFreeze(this.prisma, {
                  subscriptionId: current.id,
                  todayYmd: localDateInTz(
                      new Date(),
                      member.workspace.timezone,
                  ),
              })
            : null

        return {
            current,
            history,
            accessUntil: member.accessUntil
                ? member.accessUntil.toISOString()
                : null,
            freeze: openFreeze ? serializeSubscriptionFreeze(openFreeze) : null,
        }
    }
}
