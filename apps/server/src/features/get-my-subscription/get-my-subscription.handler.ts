import { Feature, IFeatureHandler } from '@shelfjs/features'

import { findMemberCoach } from '../../domains/subscriptions/member-coach'
import { findOpenFreeze } from '../../domains/subscriptions/services/subscription-freeze.service'
import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'
import { DAY_MS } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    serializeSubscription,
    serializeSubscriptionFreeze,
} from '../member-subscriptions/schemas'
import {
    DECLINED_VISIBLE_DAYS,
    freezeRequestWindow,
} from '../subscription-freeze-requests/freeze-request-utils'
import { serializeFreezeRequest } from '../subscription-freeze-requests/schemas'
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
            return {
                current: null,
                history: [],
                accessUntil: null,
                freeze: null,
                freezeRequest: null,
                freezeRequestWindow: null,
                coach: null,
            }
        }

        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
            include: { plan: { select: { name: true } } },
            orderBy: [
                { startDate: { sort: 'desc', nulls: 'first' } },
                { createdAt: 'desc' },
            ],
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

        const now = new Date()
        const tz = member.workspace.timezone
        const openFreeze = current
            ? await findOpenFreeze(this.prisma, {
                  subscriptionId: current.id,
                  todayYmd: localDateInTz(now, tz),
              })
            : null

        // The pending request, or a decline the member has not had a week to read.
        const request =
            current && currentRow
                ? await this.prisma.subscriptionFreezeRequest.findFirst({
                      where: {
                          subscriptionId: current.id,
                          OR: [
                              { status: 'PENDING' },
                              {
                                  status: 'DECLINED',
                                  decidedAt: {
                                      gte: new Date(
                                          now.getTime() -
                                              DECLINED_VISIBLE_DAYS * DAY_MS,
                                      ),
                                  },
                              },
                          ],
                      },
                      orderBy: { createdAt: 'desc' },
                      include: {
                          decidedBy: {
                              select: { firstname: true, lastname: true },
                          },
                      },
                  })
                : null
        const window =
            current && currentRow
                ? freezeRequestWindow({
                      now,
                      tz,
                      subscription: currentRow,
                      hasOpenFreeze: !!openFreeze,
                      hasPending: request?.status === 'PENDING',
                  })
                : null

        const memberCoach = await findMemberCoach(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.userId,
        })

        return {
            current,
            history,
            accessUntil: member.accessUntil
                ? member.accessUntil.toISOString()
                : null,
            freeze: openFreeze ? serializeSubscriptionFreeze(openFreeze) : null,
            freezeRequest: request ? serializeFreezeRequest(request) : null,
            freezeRequestWindow: window,
            coach: memberCoach?.name
                ? { name: memberCoach.name, phone: memberCoach.phone }
                : null,
        }
    }
}
