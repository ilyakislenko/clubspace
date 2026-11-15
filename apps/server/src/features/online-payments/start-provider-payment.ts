import { randomUUID } from 'crypto'

import type { Logger } from '@nestjs/common'

import type { AutopayNotificationsService } from '../../domains/autopay/autopay-notifications'
import {
    type StoredPaymentSettings,
    toGatewayCredentials,
} from '../../domains/payments/payment-credentials'
import type { PaymentGatewayClient } from '../../domains/payments/payment-gateway.client'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { environment } from '../../environments/environment'
import type { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { serializeMyPayment } from './schemas'

const PROVIDER_FAILED =
    'Не удалось создать платёж. Попробуйте позже или обратитесь в клуб'
export const AUTOPAY_SETUP_REFUSED =
    'Не удалось подключить автоплатёж — оплатите без него или обратитесь в клуб'

// Whether YooKassa should keep the card (CreateGatewayPaymentInput
// .savePaymentMethod): an autopay setup saves it; any other payment in a club
// that offers member autopay explicitly doesn't (a shop with autopay enabled
// would otherwise offer to save it on every payment, without our consent);
// elsewhere the field is not sent.
export const savePaymentMethodFor = (
    settings: { provider: string; autopayEnabled: boolean },
    autopay: boolean,
): boolean | undefined => {
    if (autopay) return true
    return settings.provider === 'YOOKASSA' && settings.autopayEnabled ? false : undefined
}

// A member's online payment through the club's provider (a tariff or an event
// ticket): a PENDING Payment row first (its id goes to the provider as
// metadata and into the return URL), then the provider's payment with an
// Idempotence-Key, then the confirmation URL the app opens. What was bought is
// granted only by the webhook, never here.
export const startProviderPayment = async (
    deps: {
        prisma: PrismaService
        gateway: PaymentGatewayClient
        logger: Logger
        // Required for an autopay setup: the admins hear when YooKassa refuses it.
        autopayNotices?: AutopayNotificationsService
    },
    p: {
        settings: StoredPaymentSettings & { autopayEnabled: boolean }
        workspaceId: string
        userId: string
        // Exactly one of the two: a tariff, or an event ticket.
        planId: string | null
        eventRegistrationId: string | null
        // The snapshot shown in lists: the tariff's name / the event's title.
        planName: string
        // Taken from the server's records (tariff / event) and priced by
        // priceOnlineItem, never the client.
        amount: number
        // The price facts the webhook copies onto the sale
        // (docs/design/2026-11-15-discounts.md §3.3).
        listPrice: number
        discountId: string | null
        discountName: string | null
        discountAmount: number
        currency: string
        description: string
        itemName: string
        customerEmail: string
        // The consent version the member accepted with «Продлевать
        // автоматически» (an autopay setup); null for a one-off payment.
        autopayConsentVersion?: string | null
    },
) => {
    if (!environment.appUrl) {
        deps.logger.error('APP_URL is not set: no return URL for payments')
        throw new BadRequestError({ message: PROVIDER_FAILED })
    }
    const autopayConsentVersion = p.autopayConsentVersion ?? null
    const payment = await deps.prisma.payment.create({
        data: {
            workspaceId: p.workspaceId,
            userId: p.userId,
            planId: p.planId,
            eventRegistrationId: p.eventRegistrationId,
            planName: p.planName.slice(0, 255),
            provider: p.settings.provider,
            amount: p.amount,
            listPrice: p.listPrice,
            discountId: p.discountId,
            discountName: p.discountName,
            discountAmount: p.discountAmount,
            currency: p.currency,
            idempotenceKey: randomUUID(),
            // Where the 54-ФЗ receipt goes; a partial refund's receipt reuses it.
            receiptEmail: p.customerEmail.slice(0, 255),
            autopayConsentVersion,
        },
    })

    let confirmationUrl: string | null = null
    let providerPaymentId: string | null = null
    let refusedAutopay: string | null = null
    try {
        const created = await deps.gateway.createPayment(
            toGatewayCredentials(p.settings, environment.encryptionKey),
            {
                paymentId: payment.id,
                workspaceId: p.workspaceId,
                idempotenceKey: payment.idempotenceKey,
                amount: payment.amount,
                currency: payment.currency,
                description: p.description,
                itemName: p.itemName,
                returnUrl: `${environment.appUrl.replace(/\/+$/, '')}/payment/${payment.id}`,
                customerEmail: p.customerEmail,
                savePaymentMethod: savePaymentMethodFor(p.settings, autopayConsentVersion !== null),
            },
        )
        confirmationUrl = created.confirmationUrl
        providerPaymentId = created.providerPaymentId
    } catch (err) {
        if (!(err instanceof PaymentGatewayError)) throw err
        deps.logger.warn(
            `Payment ${payment.id} not created at ${p.settings.provider}: ${err.message}${
                err.providerMessage ? ` (${err.providerMessage})` : ''
            }`,
        )
        // YooKassa refused the setup itself (e.g. autopay isn't enabled in the
        // shop): not a provider outage.
        if (autopayConsentVersion !== null && err.status !== null && err.status < 500) {
            refusedAutopay = (err.providerMessage ?? err.message).slice(0, 500)
        }
    }
    if (!confirmationUrl || !providerPaymentId) {
        await deps.prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'CANCELED', providerPaymentId },
        })
        if (refusedAutopay !== null) {
            await recordAutopaySetupRefused(deps, p.workspaceId, refusedAutopay)
            throw new BadRequestError({ message: AUTOPAY_SETUP_REFUSED })
        }
        throw new BadRequestError({ message: PROVIDER_FAILED })
    }

    const saved = await deps.prisma.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId, confirmationUrl },
    })
    return { payment: serializeMyPayment(saved), confirmationUrl }
}

// The settings card shows the refusal; the admins hear once a club-day.
const recordAutopaySetupRefused = async (
    deps: { prisma: PrismaService; autopayNotices?: AutopayNotificationsService },
    workspaceId: string,
    text: string,
) => {
    const now = new Date()
    await deps.prisma.workspacePaymentSettings.update({
        where: { workspaceId },
        data: { autopayLastError: text, autopayLastErrorAt: now },
    })
    await deps.autopayNotices?.staffAlert({
        workspaceId,
        refId: `setup-refused:${workspaceId}:${now.toISOString().slice(0, 10)}`,
        path: 'settings',
        message: `ЮKassa отказала в подключении автоплатежа: ${text}. Проверьте у менеджера ЮKassa, что автоплатежи включены в магазине.`,
        metadata: { workspaceId },
    })
}
