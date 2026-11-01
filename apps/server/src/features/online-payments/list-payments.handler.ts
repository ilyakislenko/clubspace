import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListPaymentsFeature,
    ListPaymentsFeatureResponse,
} from './list-payments.feature'
import { serializePayment } from './schemas'

const DEFAULT_PER_PAGE = 50

export const paymentListInclude = {
    user: { select: { firstname: true, lastname: true, email: true } },
} as const

@Feature(ListPaymentsFeature)
export class ListPaymentsHandler
    implements IFeatureHandler<ListPaymentsFeature, ListPaymentsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListPaymentsFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const page = f.payload.page ?? 1
        const perPage = f.payload.perPage ?? DEFAULT_PER_PAGE
        const where = {
            workspaceId: f.workspaceId,
            ...(f.payload.status ? { status: f.payload.status } : {}),
        }
        const [rows, total] = await Promise.all([
            this.prisma.payment.findMany({
                where,
                include: paymentListInclude,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
            this.prisma.payment.count({ where }),
        ])
        return { data: rows.map(serializePayment), total, page, perPage }
    }
}
