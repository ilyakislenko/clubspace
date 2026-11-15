import { Feature, IFeatureHandler } from '@shelfjs/features'

import { freezeRequestScopeWhere } from '../../domains/requests/open-requests'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import {
    ListPendingFreezeRequestsFeature,
    ListPendingFreezeRequestsFeatureResponse,
} from './list-pending-freeze-requests.feature'
import { serializeFreezeRequest } from './schemas'

const LIMIT = 100

@Feature(ListPendingFreezeRequestsFeature)
export class ListPendingFreezeRequestsHandler
    implements
        IFeatureHandler<
            ListPendingFreezeRequestsFeature,
            ListPendingFreezeRequestsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListPendingFreezeRequestsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        // The inbox's freeze rule (domains/requests), without the section
        // gate: a request filed before «Абонемент» went off is still decided
        // here.
        const where = freezeRequestScopeWhere(
            {
                workspaceId: f.workspaceId,
                userId: ctx.userId,
                clubWide: this.rbac.canWriteAllGroups(ctx),
            },
            new Date(),
        )
        const [rows, total] = await Promise.all([
            this.prisma.subscriptionFreezeRequest.findMany({
                where,
                orderBy: { createdAt: 'asc' },
                take: LIMIT,
                include: {
                    user: {
                        select: { firstname: true, lastname: true, email: true },
                    },
                    subscription: { select: { plan: { select: { name: true } } } },
                },
            }),
            // The list stops at LIMIT; the count does not.
            this.prisma.subscriptionFreezeRequest.count({ where }),
        ])
        return {
            data: rows.map((r) => ({
                ...serializeFreezeRequest(r),
                memberName: displayName(r.user),
                planName: r.subscription.plan.name,
            })),
            total,
        }
    }
}
