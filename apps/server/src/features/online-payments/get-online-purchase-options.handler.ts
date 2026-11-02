import { Feature, IFeatureHandler } from '@shelfjs/features'

import { isWorkspaceEntitled } from '../../domains/billing/module-entitlement'
import { directionRefSelect } from '../../domains/directions/direction-ref'
import { loadMemberDirectionIds } from '../../domains/directions/direction-scope'
import {
    type OnlineGrantStart,
    onlineGrantStart,
    sameScopeAbonements,
} from '../../domains/payments/online-grant-start'
import { scopeMatchesAny } from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
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
        // No ONLINE_PAYMENTS module: the block simply is not there.
        if (
            !workspace.subscriptionEnabled ||
            !member ||
            !isWorkspaceEntitled(workspace)
        ) {
            return NOTHING
        }

        const now = new Date()
        const [settings, allPlans, pending, memberDirections] = await Promise.all([
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
                    directions: {
                        select: {
                            directionId: true,
                            direction: directionRefSelect,
                        },
                        orderBy: [
                            { direction: { order: 'asc' } },
                            { direction: { name: 'asc' } },
                        ],
                    },
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
            loadMemberDirectionIds(this.prisma, f.workspaceId, f.userId),
        ])
        // Tariffs of the member's directions plus club-wide ones; a member
        // without directions (or a club without them) is offered everything.
        const plans =
            memberDirections.size === 0
                ? allPlans
                : allPlans.filter((p) =>
                      scopeMatchesAny(
                          p.directions.map((d) => d.directionId),
                          memberDirections,
                      ),
                  )
        if (!settings || plans.length === 0) {
            return {
                ...NOTHING,
                pendingPayment: pending ? serializeMyPayment(pending) : null,
            }
        }
        // Each tariff collides only with current abonements of its own scope.
        // The block shows one reason / renewal date: a refusal when no offered
        // tariff can be bought, a renewal date when every one renews from it.
        const vocabulary = vocabularyForWorkspaceType(workspace.type)
        const starts: OnlineGrantStart[] = plans.map((p) =>
            onlineGrantStart(
                sameScopeAbonements(
                    member.subscriptions,
                    p.directions.map((d) => d.directionId),
                ),
                workspace.timezone,
                now,
                vocabulary,
            ),
        )
        const firstBlocked = starts.find((s) => s.kind === 'blocked')
        const allBlocked = starts.every((s) => s.kind === 'blocked')
        const renewals = new Set(
            starts
                .filter((s) => s.kind !== 'blocked')
                .map((s) => (s.kind === 'renewal' ? s.fromYmd : null)),
        )
        const [onlyRenewal] = [...renewals]
        return {
            available: true,
            provider: settings.provider,
            plans: plans.map(({ directions, ...p }) => ({
                ...p,
                directions: directions.map((d) => d.direction),
            })),
            blockedReason:
                allBlocked && firstBlocked?.kind === 'blocked'
                    ? firstBlocked.message
                    : null,
            renewalFrom:
                !allBlocked && renewals.size === 1 && onlyRenewal ? onlyRenewal : null,
            pendingPayment: pending ? serializeMyPayment(pending) : null,
        }
    }
}
