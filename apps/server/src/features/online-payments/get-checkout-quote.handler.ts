import { Feature, IFeatureHandler } from '@shelfjs/features'

import { isWorkspaceEntitled } from '../../domains/billing/module-entitlement'
import type { SaleItem } from '../../domains/discounts/discount-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    GetCheckoutQuoteFeature,
    GetCheckoutQuoteFeatureResponse,
} from './get-checkout-quote.feature'
import {
    loadBuyer,
    onlinePaymentsUnavailableError,
    PENDING_REUSE_MS,
    purchasablePlanWhere,
    sectionDisabledError,
} from './load-buyer'
import { priceOnlineItem } from './price-online-item'

// The member's price of a tariff or of their event ticket before paying —
// the same priceOnlineItem the checkouts charge by, so «Оплатить N ₽» is what
// is taken. Every reason a code doesn't apply comes back as a note, never an
// error: the app shows it under the code field.
@Feature(GetCheckoutQuoteFeature)
export class GetCheckoutQuoteHandler
    implements IFeatureHandler<GetCheckoutQuoteFeature, GetCheckoutQuoteFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetCheckoutQuoteFeature): Promise<GetCheckoutQuoteFeatureResponse> {
        const now = new Date()
        const { item, timezone, pending } = f.payload.planId
            ? await this.tariff(f, f.payload.planId)
            : await this.ticket(f, f.payload.registrationId as string)
        // The member's own open checkout of this item is the one a tap would
        // reuse: its promo use doesn't count against them.
        const recent = await this.prisma.payment.findFirst({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                ...pending,
                status: 'PENDING',
                confirmationUrl: { not: null },
                createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
        })
        const price = await priceOnlineItem(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.userId,
            item,
            promoCode: f.payload.promoCode,
            now,
            today: localDateInTz(now, timezone),
            excludePaymentId: recent?.id,
        })
        return {
            listPrice: price.listPrice,
            amount: price.amount,
            currency: price.currency,
            discount: price.discount,
            promoCodeNote: price.promoCodeNote,
        }
    }

    // A tariff the member may buy online (the checkout's own refusals).
    private async tariff(f: GetCheckoutQuoteFeature, planId: string) {
        const { workspace, member } = await loadBuyer(this.prisma, f)
        if (!workspace.subscriptionEnabled) throw sectionDisabledError()
        if (!isWorkspaceEntitled(workspace)) throw onlinePaymentsUnavailableError()
        if (f.userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'У владельца клуба доступ бессрочный, абонемент не нужен',
            })
        }
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })
        const plan = await this.prisma.plan.findFirst({
            where: { ...purchasablePlanWhere(f.workspaceId), id: planId },
            select: { id: true, price: true, currency: true },
        })
        if (!plan) throw new NotFoundError({ message: 'Этот тариф нельзя купить онлайн' })
        const item: SaleItem = { planId: plan.id, eventId: null, listPrice: plan.price, currency: plan.currency }
        return { item, timezone: workspace.timezone, pending: { planId: plan.id } }
    }

    // The member's own place on a paid event (a guardian's child via act-as).
    private async ticket(f: GetCheckoutQuoteFeature, registrationId: string) {
        const registration = await this.prisma.eventRegistration.findFirst({
            where: { id: registrationId, workspaceId: f.workspaceId, userId: f.userId },
            select: {
                id: true,
                event: { select: { id: true, price: true, currency: true } },
                workspace: { select: { timezone: true } },
            },
        })
        if (!registration) throw new NotFoundError({ message: 'Запись не найдена' })
        const { event } = registration
        if (event.price === null || event.price <= 0) {
            throw new BadRequestError({ message: 'Событие бесплатное — оплачивать не нужно' })
        }
        const item: SaleItem = { planId: null, eventId: event.id, listPrice: event.price, currency: event.currency }
        return {
            item,
            timezone: registration.workspace.timezone,
            pending: { eventRegistrationId: registration.id },
        }
    }
}
