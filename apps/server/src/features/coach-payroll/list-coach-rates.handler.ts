import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadPayrollCurrency } from '../../domains/payroll/payroll-loader'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import { coachCandidatesWhere } from '../class-substitutions/class-substitution-access'
import {
    ListCoachRatesFeature,
    type ListCoachRatesFeatureResponse,
} from './list-coach-rates.feature'
import { serializeCoachRate } from './set-coach-rate.handler'

// Who can be given a rate (the owner and active coaching members) and each
// one's history, newest month first.
@Feature(ListCoachRatesFeature)
export class ListCoachRatesHandler
    implements IFeatureHandler<ListCoachRatesFeature, ListCoachRatesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListCoachRatesFeature): Promise<ListCoachRatesFeatureResponse> {
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const [staff, currency] = await Promise.all([
            this.prisma.user.findMany({
                where: coachCandidatesWhere(f.workspaceId, ctx.workspaceOwnerId),
                select: {
                    id: true,
                    firstname: true,
                    lastname: true,
                    email: true,
                    workspaceMemberships: {
                        where: { workspaceId: f.workspaceId },
                        select: { role: { select: { name: true } } },
                    },
                    coachRates: {
                        where: { workspaceId: f.workspaceId },
                        orderBy: { effectiveFrom: 'desc' },
                    },
                },
            }),
            loadPayrollCurrency(this.prisma, f.workspaceId),
        ])
        const coaches = staff
            .map((u) => {
                const newest = u.coachRates.reduce<Date | null>(
                    (max, r) => (!max || r.updatedAt > max ? r.updatedAt : max),
                    null,
                )
                return {
                    coachId: u.id,
                    name: displayName(u),
                    role:
                        u.id === ctx.workspaceOwnerId
                            ? 'owner'
                            : (u.workspaceMemberships[0]?.role.name ?? 'coach'),
                    updatedAt: newest ? newest.toISOString() : null,
                    rates: u.coachRates.map(serializeCoachRate),
                }
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.coachId.localeCompare(b.coachId))
        return { currency, coaches }
    }
}
