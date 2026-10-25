import { Feature, IFeatureHandler } from '@shelfjs/features'

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
        const now = new Date()
        const rows = await this.prisma.subscriptionFreezeRequest.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'PENDING',
                // Still someone's live current abonement (the pointer outlives
                // the row it points at).
                subscription: {
                    status: 'ACTIVE',
                    OR: [{ endDate: null }, { endDate: { gt: now } }],
                    members: { some: { status: 'ACTIVE' } },
                },
                // A coach sees what they may decide: members of their groups,
                // never their own request.
                ...(this.rbac.canWriteAllGroups(ctx)
                    ? {}
                    : {
                          userId: { not: ctx.userId },
                          user: {
                              groupMemberships: {
                                  some: {
                                      group: {
                                          workspaceId: f.workspaceId,
                                          coaches: {
                                              some: { userId: ctx.userId },
                                          },
                                      },
                                  },
                              },
                          },
                      }),
            },
            orderBy: { createdAt: 'asc' },
            take: LIMIT,
            include: {
                user: {
                    select: { firstname: true, lastname: true, email: true },
                },
                subscription: { select: { plan: { select: { name: true } } } },
            },
        })
        return {
            data: rows.map((r) => ({
                ...serializeFreezeRequest(r),
                memberName: displayName(r.user),
                planName: r.subscription.plan.name,
            })),
        }
    }
}
