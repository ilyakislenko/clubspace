import { Feature, IFeatureHandler } from '@shelfjs/features'

import { autopayOffered } from '../../domains/autopay/autopay-offer'
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
import { localDateInTz } from '../attendance/attendance-utils'
import {
    GetOnlinePurchaseOptionsFeature,
    GetOnlinePurchaseOptionsFeatureResponse,
} from './get-online-purchase-options.feature'
import {
    loadBuyer,
    PENDING_VISIBLE_MS,
    purchasablePlanWhere,
} from './load-buyer'
import { priceOnlineItem } from './price-online-item'
import { autopayOfferView, autopayTermsUrl } from './autopay-offer-view'
import { serializeMyPayment } from './schemas'

const NOTHING: GetOnlinePurchaseOptionsFeatureResponse = {
    available: false,
    provider: null,
    plans: [],
    blockedReason: null,
    renewalFrom: null,
    pendingPayment: null,
    autopayTermsUrl: null,
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
                select: { provider: true, autopayEnabled: true },
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
                    autopayAvailable: true,
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
                    // An event ticket is followed on the events screen.
                    eventRegistrationId: null,
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
        // Each card's price as the checkout would charge it without a code
        // (the family discount when it applies) — the same priceOnlineItem.
        const today = localDateInTz(now, workspace.timezone)
        const prices = await Promise.all(
            plans.map((p) =>
                priceOnlineItem(this.prisma, {
                    workspaceId: f.workspaceId,
                    userId: f.userId,
                    item: { planId: p.id, eventId: null, listPrice: p.price, currency: p.currency },
                    promoCode: undefined,
                    now,
                    today,
                }),
            ),
        )
        // «Продлевать автоматически»: where the club and the tariff allow it
        // and the member has no ACTIVE agreement on it. The renewal price is
        // the price without a code (automatic discounts only) — `prices`.
        const activeAutopay = new Set(
            (
                await this.prisma.memberAutopay.findMany({
                    where: { workspaceId: f.workspaceId, userId: f.userId, status: 'ACTIVE' },
                    select: { planId: true },
                })
            ).map((a) => a.planId),
        )
        const offers = plans.map((p, i) =>
            autopayOffered(settings, p) && !activeAutopay.has(p.id) && !prices[i].refusal
                ? autopayOfferView({
                      clubName: workspace.name,
                      plan: p,
                      amountNow: prices[i].amount,
                      renewalAmount: prices[i].amount,
                  })
                : null,
        )
        return {
            available: true,
            provider: settings.provider,
            plans: plans.map(({ directions, autopayAvailable: _offered, ...p }, i) => ({
                ...p,
                amount: prices[i].amount,
                discountName: prices[i].discountName,
                directions: directions.map((d) => d.direction),
                autopay: offers[i],
            })),
            blockedReason:
                allBlocked && firstBlocked?.kind === 'blocked'
                    ? firstBlocked.message
                    : null,
            renewalFrom:
                !allBlocked && renewals.size === 1 && onlyRenewal ? onlyRenewal : null,
            pendingPayment: pending ? serializeMyPayment(pending) : null,
            autopayTermsUrl: offers.some((o) => o !== null) ? autopayTermsUrl() : null,
        }
    }
}
