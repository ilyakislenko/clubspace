import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    isWorkspaceEntitled,
    moduleEntitlementSelect,
} from '../../domains/billing/module-entitlement'
import { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ModuleNotEntitledError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { localDateInTz } from '../attendance/attendance-utils'
import { PENDING_REUSE_MS } from '../online-payments/load-buyer'
import { priceOnlineItem } from '../online-payments/price-online-item'
import { serializeMyPayment } from '../online-payments/schemas'
import { startProviderPayment } from '../online-payments/start-provider-payment'
import {
    PayEventRegistrationOnlineFeature,
    PayEventRegistrationOnlineFeatureResponse,
} from './pay-event-registration-online.feature'

// The member pays their event ticket online through the club's provider (a
// guardian for a child via X-Act-As): only a held place (BOOKED), unpaid, of
// a paid event, in a club with a connected provider. The price is the event's
// on the server, priced by priceOnlineItem (the family discount when it
// covers events, a promo code) — exactly the quote or refused. A repeated tap
// returns the pending payment at the same price. The ticket is marked paid
// only by the webhook
// (PaymentActivationService → EventRegistrationService.markPaidOnlineInTx).
@Feature(PayEventRegistrationOnlineFeature)
export class PayEventRegistrationOnlineHandler
    implements
        IFeatureHandler<
            PayEventRegistrationOnlineFeature,
            PayEventRegistrationOnlineFeatureResponse
        >
{
    private readonly logger = new Logger(PayEventRegistrationOnlineHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
    ) {}

    async execute(
        f: PayEventRegistrationOnlineFeature,
    ): Promise<PayEventRegistrationOnlineFeatureResponse> {
        const [workspace, settings, registration] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: {
                    name: true,
                    timezone: true,
                    ...moduleEntitlementSelect('ONLINE_PAYMENTS'),
                },
            }),
            this.prisma.workspacePaymentSettings.findUnique({
                where: { workspaceId: f.workspaceId },
            }),
            this.prisma.eventRegistration.findFirst({
                where: {
                    id: f.registrationId,
                    workspaceId: f.workspaceId,
                    userId: f.invokerUserId,
                },
                include: {
                    event: {
                        select: { id: true, title: true, price: true, currency: true },
                    },
                },
            }),
        ])
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        if (!registration) {
            throw new NotFoundError({ message: 'Запись не найдена' })
        }
        if (!settings) {
            throw new BadRequestError({
                message: 'Клуб не принимает онлайн-оплату — оплатите билет в клубе',
            })
        }
        if (!isWorkspaceEntitled(workspace)) {
            throw new ModuleNotEntitledError({
                module: 'ONLINE_PAYMENTS',
                message:
                    'Онлайн-оплата в этом клубе сейчас недоступна. Оплатите билет в клубе.',
            })
        }
        const { event } = registration
        if (event.price === null || event.price <= 0) {
            throw new BadRequestError({
                message: 'Событие бесплатное — оплачивать не нужно',
            })
        }
        if (registration.isPaid) {
            throw new BadRequestError({ message: 'Билет уже оплачен' })
        }
        // Money is taken for a place only; the webhook checks it again.
        if (registration.status !== 'BOOKED') {
            throw new BadRequestError({
                message:
                    registration.status === 'WAITLISTED'
                        ? 'Вы в листе ожидания — оплатить можно, когда освободится место'
                        : 'Запись отменена',
            })
        }

        // A repeated tap (or a member back from the provider's page without
        // paying) gets the same payment instead of a second one — at the same
        // price; a code added since makes a new one.
        const now = new Date()
        const recent = await this.prisma.payment.findFirst({
            where: {
                workspaceId: f.workspaceId,
                eventRegistrationId: registration.id,
                provider: settings.provider,
                status: 'PENDING',
                confirmationUrl: { not: null },
                createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
            },
            orderBy: { createdAt: 'desc' },
        })
        const price = await priceOnlineItem(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            item: { planId: null, eventId: event.id, listPrice: event.price, currency: event.currency },
            promoCode: f.payload.promoCode,
            now,
            today: localDateInTz(now, workspace.timezone),
            excludePaymentId: recent?.id,
        })
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

        // The receipt goes to the member — or to the guardian paying for a
        // child (a child profile has no e-mail).
        const people = await this.prisma.user.findMany({
            where: { id: { in: [f.invokerUserId, f.actorUserId] } },
            select: { id: true, email: true },
        })
        const email =
            people.find((u) => u.id === f.invokerUserId)?.email ??
            people.find((u) => u.id === f.actorUserId)?.email ??
            null
        if (email === null) {
            throw new BadRequestError({
                message:
                    'Для онлайн-оплаты нужен e-mail в профиле — на него придёт чек',
            })
        }

        return startProviderPayment(
            { prisma: this.prisma, gateway: this.gateway, logger: this.logger },
            {
                settings,
                workspaceId: f.workspaceId,
                userId: f.invokerUserId,
                planId: null,
                eventRegistrationId: registration.id,
                planName: event.title,
                amount: price.amount,
                listPrice: price.listPrice,
                discountId: price.discountId,
                discountName: price.discountName,
                discountAmount: price.discountAmount,
                currency: event.currency,
                description: `Билет «${event.title}» — ${workspace.name}`,
                itemName: `Билет «${event.title}»`,
                customerEmail: email,
            },
        )
    }
}
