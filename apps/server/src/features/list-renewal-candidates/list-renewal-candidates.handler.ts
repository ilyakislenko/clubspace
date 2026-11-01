import { Feature, IFeatureHandler } from '@shelfjs/features'

import { currentSubscriptionOrderBy } from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListRenewalCandidatesFeature,
    ListRenewalCandidatesFeatureResponse,
} from './list-renewal-candidates.feature'
import {
    REASON_RANK,
    renewalNeed,
    renewalSoon,
    renewalSubscriptionSelect,
    renewalSubscriptionsWhere,
} from './list-renewal-candidates-utils'

@Feature(ListRenewalCandidatesFeature)
export class ListRenewalCandidatesHandler
    implements
        IFeatureHandler<
            ListRenewalCandidatesFeature,
            ListRenewalCandidatesFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListRenewalCandidatesFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Смотреть список на продление может только администратор клуба',
        )

        const now = new Date()
        const soon = renewalSoon(now)

        const members = await this.prisma.workspaceMember.findMany({
            where: { workspaceId: f.workspaceId, status: 'ACTIVE' },
            select: {
                userId: true,
                accessUntil: true,
                user: {
                    select: {
                        firstname: true,
                        lastname: true,
                        email: true,
                    },
                },
                subscriptions: {
                    where: renewalSubscriptionsWhere(now),
                    orderBy: currentSubscriptionOrderBy,
                    select: renewalSubscriptionSelect,
                },
            },
        })

        const candidates = members
            .map((m) => {
                const need = renewalNeed(m.subscriptions, m.accessUntil, {
                    now,
                    soon,
                })
                if (!need) return null
                const sub = need.subscription
                return {
                    userId: m.userId,
                    firstname: m.user.firstname,
                    lastname: m.user.lastname,
                    email: m.user.email,
                    reason: need.reason,
                    classesRemaining: need.current
                        ? (sub?.classesRemaining ?? null)
                        : null,
                    classesTotal: need.current
                        ? (sub?.classesTotal ?? null)
                        : null,
                    accessUntil: m.accessUntil
                        ? m.accessUntil.toISOString()
                        : null,
                    planName: sub?.plan.name ?? null,
                    endDate: sub?.endDate ? sub.endDate.toISOString() : null,
                    directions: sub
                        ? sub.directions.map((d) => d.direction)
                        : [],
                    sortKey: (need.end ?? m.accessUntil)?.toISOString() ?? null,
                }
            })
            .filter((c): c is NonNullable<typeof c> => c !== null)

        candidates.sort((a, b) => {
            const byReason = REASON_RANK[a.reason] - REASON_RANK[b.reason]
            if (byReason !== 0) return byReason
            // Soonest end first; nulls (no window) last.
            const ax = a.sortKey ?? '9999'
            const bx = b.sortKey ?? '9999'
            return ax.localeCompare(bx)
        })

        return { data: candidates.map(({ sortKey: _sortKey, ...c }) => c) }
    }
}
