import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    narrowCallList,
    summarizeCallList,
} from '../../domains/retention/call-list'
import { CallListCacheService } from '../../domains/retention/call-list-cache.service'
import { PrismaService } from '../../infrastructure/prisma'
import { isClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from '../../domains/analytics/analytics-scope'
import {
    AT_RISK_DEFAULT_PER_PAGE,
    ListAtRiskMembersFeature,
    ListAtRiskMembersFeatureResponse,
} from './list-at-risk-members.feature'
import { serializeAtRiskMember } from './schemas'

// One list for every surface: sport leads see the whole club, a coach or a
// direction manager the groups they act on as their own (ownGroupsWhere —
// the same groups «Связались» may be logged for, so every row is callable).
@Feature(ListAtRiskMembersFeature)
export class ListAtRiskMembersHandler
    implements
        IFeatureHandler<
            ListAtRiskMembersFeature,
            ListAtRiskMembersFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly callLists: CallListCacheService,
    ) {}

    async execute(
        f: ListAtRiskMembersFeature,
    ): Promise<ListAtRiskMembersFeatureResponse> {
        const { payload } = f
        const { ctx, scope } = await resolveAnalyticsScope(
            this.prisma,
            this.rbac,
            f,
            payload,
        )
        const list = await this.callLists.get(f.workspaceId)
        const entries = narrowCallList(list.entries, scope.groupIds)
        const summary = summarizeCallList(entries)
        // «₽ на кону» is club money: only the owner and admins get amounts.
        const seesMoney = isClubAdmin(ctx, f)

        const snoozed = payload.snoozed ?? false
        const rows = entries.filter(
            (e) =>
                e.snoozed === snoozed &&
                (!payload.reason || e.reason === payload.reason),
        )
        const curPage = payload.curPage ?? 1
        const perPage = payload.perPage ?? AT_RISK_DEFAULT_PER_PAGE
        return {
            data: rows
                .slice((curPage - 1) * perPage, curPage * perPage)
                .map((e) => serializeAtRiskMember(e, seesMoney)),
            summary: {
                ...summary,
                moneyAtStake: seesMoney ? summary.moneyAtStake : null,
            },
            total: rows.length,
            curPage,
            perPage,
            scoredAt: list.scoredAt,
        }
    }
}
