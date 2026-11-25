import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AUTOPAY_CONSENT_VERSION } from '../../domains/autopay/autopay-consent'
import { AutopayNotificationsService } from '../../domains/autopay/autopay-notifications'
import { autopayOffered, autopayRenewalPrice } from '../../domains/autopay/autopay-offer'
import { isWorkspaceEntitled } from '../../domains/billing/module-entitlement'
import {
    onlineGrantStart,
    sameScopeAbonements,
} from '../../domains/payments/online-grant-start'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { scopeDirectionIds } from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    CreatePaymentFeature,
    CreatePaymentFeatureResponse,
} from './create-payment.feature'
import {
    loadBuyer,
    loadReceiptEmail,
    NO_RECEIPT_EMAIL,
    onlinePaymentsUnavailableError,
    payerOf,
    PENDING_REUSE_MS,
    purchasablePlanWhere,
    sectionDisabledError,
} from './load-buyer'
import { priceOnlineItem } from './price-online-item'
import { serializeMyPayment } from './schemas'
import { startProviderPayment } from './start-provider-payment'

// An autopay charge of the tariff still processing blocks a checkout this long
// (the pass's own in-flight window).
const AUTOPAY_CHARGE_INFLIGHT_MS = 3 * 24 * 60 * 60 * 1000

// The member buys a tariff online (startProviderPayment), optionally ticking
// «Продлевать автоматически» on a tariff the club renews by autopay
// (docs/design/2026-11-15-member-autopay.md §3.3). The abonement — and the
// autopay agreement — are created only by the activation, never here.
@Feature(CreatePaymentFeature)
export class CreatePaymentHandler
    implements IFeatureHandler<CreatePaymentFeature, CreatePaymentFeatureResponse>
{
    private readonly logger = new Logger(CreatePaymentHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
        private readonly autopayNotices: AutopayNotificationsService,
    ) {}

    async execute(f: CreatePaymentFeature): Promise<CreatePaymentFeatureResponse> {
        const { workspace, member } = await loadBuyer(this.prisma, f)
        if (!workspace.subscriptionEnabled) throw sectionDisabledError()
        if (!isWorkspaceEntitled(workspace)) throw onlinePaymentsUnavailableError()
        if (f.userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'У владельца клуба доступ бессрочный, абонемент не нужен',
            })
        }
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const settings = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        if (!settings) {
            throw new BadRequestError({ message: 'Клуб не принимает онлайн-оплату' })
        }
        const plan = await this.prisma.plan.findFirst({
            where: { ...purchasablePlanWhere(f.workspaceId), id: f.payload.planId },
            select: {
                id: true,
                name: true,
                price: true,
                currency: true,
                autopayAvailable: true,
                directions: { select: { directionId: true } },
            },
        })
        if (!plan) {
            throw new NotFoundError({
                message: 'Этот тариф нельзя купить онлайн',
            })
        }
        const autopay = f.payload.autopay
        // The card would be the guardian's and a child may have two of them:
        // a child's abonement renews by purchase
        // (docs/design/2026-11-26-parent-pays-for-child.md §10).
        if (autopay && f.actorUserId !== f.userId) {
            throw new BadRequestError({
                message:
                    'Автоплатёж для абонемента ребёнка не подключается — продлевайте его покупкой',
            })
        }
        if (autopay) await this.assertAutopayAllowed(f, settings, plan)
        const payerUserId = payerOf(f.userId, f.actorUserId)

        const now = new Date()
        const start = onlineGrantStart(
            sameScopeAbonements(member.subscriptions, scopeDirectionIds(plan)),
            workspace.timezone,
            now,
            vocabularyForWorkspaceType(workspace.type),
        )
        if (start.kind === 'blocked') {
            throw new BadRequestError({ message: start.message })
        }
        // This tariff's autopay charge is still at the provider: a second
        // purchase now would be paid and then refused at the grant.
        const charging = await this.prisma.payment.findFirst({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                planId: plan.id,
                status: 'PENDING',
                idempotenceKey: { startsWith: 'autopay:' },
                createdAt: { gte: new Date(now.getTime() - AUTOPAY_CHARGE_INFLIGHT_MS) },
            },
            select: { id: true },
        })
        if (charging) {
            throw new BadRequestError({
                message: 'Автоплатёж по этому тарифу сейчас списывается — подождите несколько минут',
            })
        }
        const renewalAmount = autopay
            ? await this.assertRenewalAmount(f, plan, workspace.timezone, now)
            : null

        // A repeated tap (or a member who came back from the provider's page
        // without paying) gets the same payment instead of a second one — at
        // the same price and with the same autopay choice: a member who adds a
        // code or flips the switch gets a new payment, and the old one lapses.
        // Its own use of a promo is not counted against it. Only the same
        // payer's: the child's other parent gets their own page and receipt.
        const recent = await this.prisma.payment.findFirst({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                payerUserId,
                planId: plan.id,
                provider: settings.provider,
                status: 'PENDING',
                confirmationUrl: { not: null },
                autopayConsentVersion: autopay ? AUTOPAY_CONSENT_VERSION : null,
                autopayRenewalAmount: renewalAmount,
                createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
            },
            orderBy: { createdAt: 'desc' },
        })
        const price = await priceOnlineItem(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.userId,
            item: { planId: plan.id, eventId: null, listPrice: plan.price, currency: plan.currency },
            promoCode: f.payload.promoCode,
            now,
            today: localDateInTz(now, workspace.timezone),
            excludePaymentId: recent?.id,
        })
        // Exactly the quoted price, or no purchase (ЗоЗПП ст. 10).
        if (price.refusal) throw new BadRequestError({ message: price.refusal })
        if (
            recent?.confirmationUrl &&
            recent.amount === price.amount &&
            recent.discountId === price.discountId
        ) {
            return {
                payment: serializeMyPayment(recent),
                confirmationUrl: recent.confirmationUrl,
            }
        }

        // The receipt goes to the holder — or to the guardian paying for a
        // child (a child profile has no e-mail).
        const customerEmail = await loadReceiptEmail(this.prisma, {
            holderId: f.userId,
            actorId: f.actorUserId,
        })
        if (customerEmail === null) {
            throw new BadRequestError({ message: NO_RECEIPT_EMAIL })
        }
        return startProviderPayment(
            {
                prisma: this.prisma,
                gateway: this.gateway,
                logger: this.logger,
                autopayNotices: this.autopayNotices,
            },
            {
                settings,
                workspaceId: f.workspaceId,
                userId: f.userId,
                payerUserId,
                planId: plan.id,
                eventRegistrationId: null,
                planName: plan.name,
                amount: price.amount,
                listPrice: price.listPrice,
                discountId: price.discountId,
                discountName: price.discountName,
                discountAmount: price.discountAmount,
                currency: plan.currency,
                description: `Абонемент «${plan.name}» — ${workspace.name}`,
                itemName: `Абонемент «${plan.name}»`,
                customerEmail,
                autopayConsentVersion: autopay ? AUTOPAY_CONSENT_VERSION : null,
                autopayRenewalAmount: renewalAmount,
                autopayShopId: autopay ? settings.shopId : null,
            },
        )
    }

    // The switch is honoured only where it was offered, on the consent text
    // the server serves now, and never twice: an ACTIVE agreement on this
    // tariff refuses; a NEEDS_ACTION one is re-armed by paying with a new card.
    private async assertAutopayAllowed(
        f: CreatePaymentFeature,
        settings: { provider: string; autopayEnabled: boolean },
        plan: { id: string; autopayAvailable: boolean },
    ) {
        if (!autopayOffered(settings, plan)) {
            throw new BadRequestError({
                message: 'Автоплатёж для этого тарифа недоступен',
            })
        }
        if (f.payload.autopayConsentVersion !== AUTOPAY_CONSENT_VERSION) {
            throw new BadRequestError({
                message: 'Условия автоплатежа обновились — обновите экран',
            })
        }
        const active = await this.prisma.memberAutopay.findFirst({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                planId: plan.id,
                status: 'ACTIVE',
            },
            select: { id: true },
        })
        if (active) {
            throw new BadRequestError({
                message: 'Автоплатёж по этому тарифу уже включён',
            })
        }
    }

    // The renewal amount the consent showed must still be the one a renewal
    // would charge (automatic discounts only): the agreement stores exactly
    // what the member agreed to.
    private async assertRenewalAmount(
        f: CreatePaymentFeature,
        plan: { id: string; price: number; currency: string },
        timezone: string,
        now: Date,
    ): Promise<number> {
        const renewal = await autopayRenewalPrice(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.userId,
            plan,
            now,
            today: localDateInTz(now, timezone),
        })
        if (f.payload.autopayRenewalAmount !== renewal.amount) {
            throw new ConflictError({
                message: 'Сумма продления изменилась — обновите экран',
            })
        }
        return renewal.amount
    }
}
