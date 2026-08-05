import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AssignSubscriptionFeature,
    AssignSubscriptionFeatureResponse,
} from './assign-subscription.feature'
import { serializeSubscription } from './schemas'

@Feature(AssignSubscriptionFeature)
export class AssignSubscriptionHandler
    implements
        IFeatureHandler<
            AssignSubscriptionFeature,
            AssignSubscriptionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: AssignSubscriptionFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Назначать абонементы может только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        if (f.userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'У владельца клуба доступ бессрочный, абонемент не нужен',
            })
        }

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const startDate = f.payload.startDate
            ? new Date(`${f.payload.startDate}T00:00:00Z`)
            : new Date()

        const { subscription, accessUntil } =
            await this.subscriptions.grantFromPlan({
                workspaceId: f.workspaceId,
                workspaceMemberId: member.id,
                planId: f.payload.planId,
                startDate,
                amountPaid: f.payload.amountPaid,
                source: 'MANUAL',
            })

        this.realtime.invalidate(f.workspaceId, ['subscription'])

        return {
            subscription: serializeSubscription(subscription),
            accessUntil: accessUntil ? accessUntil.toISOString() : null,
        }
    }
}
