import { Feature, IFeatureHandler } from '@shelfjs/features'

import { computePayrollMonth } from '../../domains/payroll/payroll-month'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetPayrollMonthFeature,
    type GetPayrollMonthFeatureResponse,
} from './get-payroll-month.feature'
import { serializePayrollMonth } from './schemas'

// «Отчёты → Выплаты»: the month's table — frozen when closed, live when open.
@Feature(GetPayrollMonthFeature)
export class GetPayrollMonthHandler
    implements IFeatureHandler<GetPayrollMonthFeature, GetPayrollMonthFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetPayrollMonthFeature): Promise<GetPayrollMonthFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        return serializePayrollMonth(
            await computePayrollMonth(this.prisma, {
                workspaceId: f.workspaceId,
                month: f.payload.month,
                now: new Date(),
            }),
        )
    }
}
