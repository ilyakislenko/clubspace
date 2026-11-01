import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    subscriptionDtoInclude,
} from '../../domains/subscriptions/current-subscriptions'
import { DAY_MS, ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { findMemberCoach } from '../../domains/subscriptions/member-coach'
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
                accessUntil: true,
                workspace: { select: { timezone: true } },
            },
        })
        // Owner (or anyone without a member row) has no abonement — unlimited.
        if (!member) {
            return { abonements: [], history: [], accessUntil: null, coach: null }
        }

        const now = new Date()
        const tz = member.workspace.timezone
        const today = ymdToDbDate(localDateInTz(now, tz))
        const [subs, current, memberCoach] = await Promise.all([
            this.prisma.subscription.findMany({
                where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
                include: subscriptionDtoInclude,
                orderBy: [
                    { startDate: { sort: 'desc', nulls: 'first' } },
                    { createdAt: 'desc' },
                ],
            }),
            // History keeps every row, live or not; only current ones get the
            // freeze state.
            this.prisma.subscription.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    workspaceMemberId: member.id,
                    ...currentSubscriptionWhere(now),
                },
                include: {
                    ...subscriptionDtoInclude,
                    // The first freeze that has not finished yet (running or upcoming).
                    freezes: {
                        where: { untilDate: { gte: today } },
                        orderBy: { fromDate: 'asc' },
                        take: 1,
                    },
                    // The newest request only: pending, or a decline the member
                    // has not had a week to read. An older decline never
                    // resurfaces behind a newer one.
                    freezeRequests: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        include: {
                            decidedBy: {
                                select: { firstname: true, lastname: true },
                            },
                        },
                    },
                },
                orderBy: currentSubscriptionOrderBy,
            }),
            findMemberCoach(this.prisma, {
                workspaceId: f.workspaceId,
                userId: f.userId,
            }),
        ])

        const abonements = current.map(({ freezes, freezeRequests, ...s }) => {
            const openFreeze = freezes[0] ?? null
            const latest = freezeRequests[0] ?? null
            const request =
                latest &&
                (latest.status === 'PENDING' ||
                    (latest.status === 'DECLINED' &&
                        latest.decidedAt !== null &&
                        latest.decidedAt.getTime() >=
                            now.getTime() - DECLINED_VISIBLE_DAYS * DAY_MS))
                    ? latest
                    : null
            return {
                ...serializeSubscription(s),
                freeze: openFreeze ? serializeSubscriptionFreeze(openFreeze) : null,
                freezeRequest: request ? serializeFreezeRequest(request) : null,
                freezeRequestWindow: freezeRequestWindow({
                    now,
                    tz,
                    subscription: s,
                    hasOpenFreeze: !!openFreeze,
                    hasPending: request?.status === 'PENDING',
                }),
            }
        })

        return {
            abonements,
            history: subs.map(serializeSubscription),
            accessUntil: member.accessUntil
                ? member.accessUntil.toISOString()
                : null,
            coach: memberCoach?.name
                ? { name: memberCoach.name, phone: memberCoach.phone }
                : null,
        }
    }
}
