import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadRenewalDue } from '../../domains/subscriptions/renewal-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    analyticsScopeMemberWhere,
    resolveAnalyticsScope,
} from '../../domains/analytics/analytics-scope'
import { loadAutopayStatuses } from '../member-autopay/autopay-status'
import {
    ListRenewalCandidatesFeature,
    ListRenewalCandidatesFeatureResponse,
    RENEWALS_DEFAULT_PER_PAGE,
} from './list-renewal-candidates.feature'
import { serializeRenewalCandidate } from './schemas'

// «Продлить»: the club's students due for renewal (renewal-rules — the same
// set the dashboard tile counts and the members filter lists), most urgent
// first. Sport leads only, the whole club; the filters narrow it to groups.
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

    async execute(
        f: ListRenewalCandidatesFeature,
    ): Promise<ListRenewalCandidatesFeatureResponse> {
        await assertSportLead(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Смотреть список на продление может только администратор клуба',
        )
        const { scope } = await resolveAnalyticsScope(
            this.prisma,
            this.rbac,
            f,
            f.payload,
        )
        const now = new Date()
        const due = await loadRenewalDue(this.prisma, f.workspaceId, now, {
            memberWhere: analyticsScopeMemberWhere(scope),
        })
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? RENEWALS_DEFAULT_PER_PAGE
        const page = due.slice((curPage - 1) * perPage, curPage * perPage)
        const autopays = await loadAutopayStatuses(this.prisma, {
            workspaceId: f.workspaceId,
            userIds: page.map((r) => r.userId),
            now,
        })
        return {
            data: page.map((r) => serializeRenewalCandidate(r, autopays.get(r.userId))),
            total: due.length,
            curPage,
            perPage,
        }
    }
}
