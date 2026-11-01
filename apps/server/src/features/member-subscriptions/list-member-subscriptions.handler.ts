import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    subscriptionDtoInclude,
} from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDateInTz } from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import { serializeFreezeRequest } from '../subscription-freeze-requests/schemas'
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
            select: {
                id: true,
                user: {
                    select: { firstname: true, lastname: true, email: true },
                },
            },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const now = new Date()
        const [subs, current, freezes, workspace] = await Promise.all([
            this.prisma.subscription.findMany({
                where: { workspaceId: f.workspaceId, workspaceMemberId: member.id },
                include: subscriptionDtoInclude,
                orderBy: [
                    { startDate: { sort: 'desc', nulls: 'first' } },
                    { createdAt: 'desc' },
                ],
            }),
            this.prisma.subscription.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    workspaceMemberId: member.id,
                    ...currentSubscriptionWhere(now),
                },
                include: {
                    ...subscriptionDtoInclude,
                    freezeRequests: {
                        where: { status: 'PENDING' },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
                orderBy: currentSubscriptionOrderBy,
            }),
            this.prisma.subscriptionFreeze.findMany({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                orderBy: { fromDate: 'desc' },
            }),
            this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: { timezone: true },
            }),
        ])

        // A coach never manages their own abonement (assign / mark paid / freeze
        // refuse it), so don't offer the buttons that would answer 403.
        const isSelf = f.userId === f.invokerUserId
        const canManage =
            (this.rbac.canWriteAllGroups(ctx) || !isSelf) &&
            (await this.rbac.canWriteMember(ctx, f.userId))
        const tz = workspace?.timezone ?? 'UTC'
        return {
            memberName: displayName(member.user),
            abonements: current.map(({ freezeRequests, ...s }) => ({
                ...serializeSubscription(s),
                freezeRequest: freezeRequests[0]
                    ? serializeFreezeRequest(freezeRequests[0])
                    : null,
                // Where a back-to-back renewal starts: the club-local day the
                // time-only abonement ends. A class pack is never renewed over
                // (the server refuses while classes are left), so no date then.
                renewFrom:
                    canManage && s.classesTotal === null && s.endDate
                        ? localDateInTz(s.endDate, tz)
                        : null,
            })),
            history: subs.map(serializeSubscription),
            freezes: freezes.map(serializeSubscriptionFreeze),
            permissions: {
                canManage,
                canCancel: this.rbac.canWriteAllGroups(ctx),
                canUnmarkPayment: this.rbac.canWriteAllGroups(ctx),
            },
        }
    }
}
