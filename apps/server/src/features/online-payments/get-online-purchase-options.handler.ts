import { Feature, IFeatureHandler } from '@shelfjs/features'

import { onlineGrantStart } from '../../domains/payments/online-grant-start'
import { PrismaService } from '../../infrastructure/prisma'
import {
    GetOnlinePurchaseOptionsFeature,
    GetOnlinePurchaseOptionsFeatureResponse,
} from './get-online-purchase-options.feature'
import {
    loadBuyer,
    PENDING_VISIBLE_MS,
    purchasablePlanWhere,
} from './load-buyer'
import { serializeMyPayment } from './schemas'

const NOTHING: GetOnlinePurchaseOptionsFeatureResponse = {
    available: false,
    provider: null,
    plans: [],
    blockedReason: null,
    renewalFrom: null,
    pendingPayment: null,
}

// What the member's «Оплатить онлайн» block shows. Read on every subscription
// screen refresh, so a club without online payments (or with the section off)
// answers an empty payload rather than an error.
@Feature(GetOnlinePurchaseOptionsFeature)
export class GetOnlinePurchaseOptionsHandler
    implements
        IFeatureHandler<
            GetOnlinePurchaseOptionsFeature,
            GetOnlinePurchaseOptionsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(
        f: GetOnlinePurchaseOptionsFeature,
    ): Promise<GetOnlinePurchaseOptionsFeatureResponse> {
        const { workspace, member } = await loadBuyer(this.prisma, f)
        if (!workspace.subscriptionEnabled || !member) return NOTHING

        const now = new Date()
        const [settings, plans, pending] = await Promise.all([
            this.prisma.workspacePaymentSettings.findUnique({
                where: { workspaceId: f.workspaceId },
                select: { provider: true },
            }),
            this.prisma.plan.findMany({
                where: purchasablePlanWhere(f.workspaceId),
                orderBy: [{ price: 'asc' }, { name: 'asc' }],
                select: {
                    id: true,
                    name: true,
                    description: true,
                    price: true,
                    currency: true,
                    durationDays: true,
                    classCount: true,
                    directionId: true,
                },
            }),
            this.prisma.payment.findFirst({
                where: {
                    workspaceId: f.workspaceId,
                    userId: f.userId,
                    status: 'PENDING',
                    providerPaymentId: { not: null },
                    createdAt: { gte: new Date(now.getTime() - PENDING_VISIBLE_MS) },
                },
                orderBy: { createdAt: 'desc' },
            }),
        ])
        if (!settings || plans.length === 0) {
            return {
                ...NOTHING,
                pendingPayment: pending ? serializeMyPayment(pending) : null,
            }
        }
        const start = onlineGrantStart(member.subscription, workspace.timezone, now)
        return {
            available: true,
            provider: settings.provider,
            plans,
            blockedReason: start.kind === 'blocked' ? start.message : null,
            renewalFrom: start.kind === 'renewal' ? start.fromYmd : null,
            pendingPayment: pending ? serializeMyPayment(pending) : null,
        }
    }
}
