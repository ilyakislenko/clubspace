import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { vocabularyForWorkspaceType } from '../../../shared/utils/club-vocabulary'
import { AuditService } from '../../audit/services/audit.service'
import { EventRegistrationService } from '../../event-registrations/event-registration.service'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../realtime/realtime-emitter.service'
import { SubscriptionService } from '../../subscriptions/services/subscription.service'
import { currentSubscriptionWhere } from '../../subscriptions/current-subscriptions'
import {
    onlineGrantAbonementSelect,
    onlineGrantStart,
    sameScopeAbonements,
} from '../online-grant-start'
import { formatRuDate } from '../../../shared/utils/format-ru-date'
import { formatMoney } from '../../analytics/money'
import { autopayNextChargeOn } from '../../autopay/autopay-rules'
import {
    type AutopaySetup,
    MemberAutopayAgreementsService,
} from '../../autopay/member-autopay-agreements.service'
import {
    type GatewayPayment,
    toMinorUnits,
} from '../payment-gateway.types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ProviderStatusOutcome =
    // The abonement was created and linked / the ticket marked paid.
    | 'activated'
    // Paid, but the abonement could not be created / the ticket not marked
    // paid; staff decide (or refund).
    | 'paid-not-activated'
    | 'canceled'
    // Already handled (a retried or concurrent webhook), still pending, or
    // not ours — nothing changed.
    | 'unchanged'

type PaymentRow = {
    id: string
    workspaceId: string
    userId: string
    planId: string | null
    eventRegistrationId: string | null
    planName: string
    provider: 'YOOKASSA' | 'STRIPE'
    providerPaymentId: string | null
    amount: number
    currency: string
    status: string
    // The checkout's price facts, copied onto the sale (no re-check: the
    // member paid the quoted price; docs/design/2026-11-15-discounts.md §3.3).
    listPrice: number | null
    discountId: string | null
    discountName: string | null
    discountAmount: number
    // Member autopay: the agreement a renewal charge belongs to (set on a
    // setup checkout only by its activation), and the consent version a
    // setup checkout recorded.
    autopayId: string | null
    autopayConsentVersion: string | null
    idempotenceKey: string
    receiptEmail: string | null
    createdAt: Date
    autopayRenewalAmount: number | null
    autopayShopId: string | null
}

// The sale's price facts as the activation copies them and audits them.
const priceFacts = (payment: PaymentRow) => ({
    listPrice: payment.listPrice,
    discountId: payment.discountId,
    discountName: payment.discountName,
    discountAmount: payment.discountAmount,
})

// Applies the provider's (verified) view of a payment to our Payment row. The
// webhooks of both providers end here, so a success is handled identically:
// the Payment is claimed PENDING → SUCCEEDED with a compare-and-set in the same
// transaction that creates the abonement (or marks the event ticket paid) — a
// duplicate or concurrent delivery finds nothing to claim and changes nothing.
@Injectable()
export class PaymentActivationService {
    private readonly logger = new Logger(PaymentActivationService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly subscriptions: SubscriptionService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
        private readonly eventRegistrations: EventRegistrationService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async applyProviderStatus(p: {
        workspaceId: string
        gateway: GatewayPayment
        now?: Date
    }): Promise<ProviderStatusOutcome> {
        const payment =
            (await this.prisma.payment.findFirst({
                where: {
                    workspaceId: p.workspaceId,
                    providerPaymentId: p.gateway.providerPaymentId,
                },
            })) ?? (await this.claimByMetadata(p.workspaceId, p.gateway))
        if (!payment) {
            this.logger.warn(
                `Webhook for unknown payment ${p.gateway.providerPaymentId} in workspace ${p.workspaceId}`,
            )
            return 'unchanged'
        }
        const now = p.now ?? new Date()

        if (p.gateway.status === 'CANCELED') {
            const failureReason = p.gateway.cancellationReason?.slice(0, 500) ?? null
            const res = await this.prisma.payment.updateMany({
                where: { id: payment.id, status: 'PENDING' },
                data: { status: 'CANCELED', failureReason },
            })
            if (res.count !== 1) return 'unchanged'
            this.realtime.invalidate(payment.workspaceId, ['payments'])
            // A renewal charge (not a setup checkout) counts as a decline.
            if (payment.autopayId && !payment.autopayConsentVersion) {
                await this.autopay.onChargeDeclined(payment, failureReason, now)
            }
            return 'canceled'
        }
        if (p.gateway.status !== 'SUCCEEDED') return 'unchanged'

        // The provider must have taken exactly what we asked for.
        const expected = toMinorUnits(payment.amount, payment.currency)
        if (
            p.gateway.amountMinor !== expected ||
            p.gateway.currency?.toUpperCase() !== payment.currency.toUpperCase()
        ) {
            this.logger.error(
                `Payment ${payment.id}: provider reports ${p.gateway.amountMinor} ${p.gateway.currency}, expected ${expected} ${payment.currency} — not activated`,
            )
            return 'unchanged'
        }

        return payment.eventRegistrationId
            ? this.activateTicket(
                  { ...payment, eventRegistrationId: payment.eventRegistrationId },
                  now,
              )
            : this.activate(payment, p.gateway, now)
    }

    // A payment whose provider id never reached us (the create answer was
    // lost): the provider echoes our Payment.id in its metadata. Only a row of
    // this club still without a provider id is claimed (compare-and-set), so a
    // forged metadata id can't take over another payment.
    private async claimByMetadata(workspaceId: string, gateway: GatewayPayment) {
        const id = gateway.metadataPaymentId
        if (!id || !UUID.test(id)) return null
        const claimed = await this.prisma.payment.updateMany({
            where: { id, workspaceId, providerPaymentId: null },
            data: { providerPaymentId: gateway.providerPaymentId },
        })
        if (claimed.count !== 1) return null
        return this.prisma.payment.findUnique({ where: { id } })
    }

    // An event ticket: the claim and the «paid ONLINE» mark commit together.
    // The place must still be held and unpaid (EventRegistrationService
    // .markPaidOnlineInTx, under the event lock); otherwise the payment stays
    // SUCCEEDED with the reason as activationError — the money is in, the
    // place is not, so staff refund it from the payments page. The ticket
    // counts towards revenue through the registration only, never twice.
    private async activateTicket(
        payment: PaymentRow & { eventRegistrationId: string },
        now: Date,
    ): Promise<ProviderStatusOutcome> {
        const result = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.payment.updateMany({
                where: { id: payment.id, status: 'PENDING' },
                data: { status: 'SUCCEEDED', paidAt: now },
            })
            if (claimed.count !== 1) return null
            const marked = await this.eventRegistrations.markPaidOnlineInTx(tx, {
                registrationId: payment.eventRegistrationId,
                amount: payment.amount,
                currency: payment.currency,
                ...priceFacts(payment),
                now,
            })
            if ('refused' in marked) {
                await tx.payment.update({
                    where: { id: payment.id },
                    data: { activationError: marked.refused.slice(0, 500) },
                })
            }
            return marked
        })
        if (!result) return 'unchanged'

        const refused = 'refused' in result ? result.refused : null
        if (refused) {
            this.logger.warn(
                `Payment ${payment.id} succeeded but the ticket was not marked paid: ${refused}`,
            )
        }
        await this.audit.record({
            action: 'payment.succeeded',
            targetType: 'member',
            targetId: payment.userId,
            workspaceId: payment.workspaceId,
            actorId: payment.userId,
            metadata: {
                paymentId: payment.id,
                provider: payment.provider,
                planName: payment.planName,
                amount: payment.amount,
                currency: payment.currency,
                ...priceFacts(payment),
                ...(refused ? { activationError: refused } : {}),
            },
        })
        this.realtime.invalidate(payment.workspaceId, ['payments'])
        if (refused) {
            await this.notifyMember(payment, {
                topic: 'Оплата получена',
                message: `Оплата за «${payment.planName}» получена, но место не подтверждено: ${refused}. Администратор клуба вернёт деньги — мы ему сообщили.`,
            })
            return 'paid-not-activated'
        }
        this.eventRegistrations.invalidate(payment.workspaceId)
        await this.notifyMember(payment, {
            topic: 'Оплата прошла',
            message: `Билет на «${payment.planName}» оплачен. До встречи!`,
        })
        return 'activated'
    }

    private async activate(
        payment: PaymentRow,
        gateway: GatewayPayment,
        now: Date,
    ): Promise<ProviderStatusOutcome> {
        // A renewal charge of an agreement; a setup checkout has the consent.
        const isRenewal = !!payment.autopayId && !payment.autopayConsentVersion
        const isSetup = !!payment.autopayConsentVersion
        let granted: {
            subscriptionId: string
            planName: string
            accessUntil: Date | null
            timezone: string
            sub: {
                startDate: Date | null
                endDate: Date | null
                classesTotal: number | null
                classesRemaining: number | null
            }
            setup: AutopaySetup | null
            afterCancel: boolean
        } | null
        try {
            granted = await this.prisma.$transaction(async (tx) => {
                const claimed = await tx.payment.updateMany({
                    where: { id: payment.id, status: 'PENDING' },
                    data: { status: 'SUCCEEDED', paidAt: now },
                })
                if (claimed.count !== 1) return null

                const member = await tx.workspaceMember.findFirst({
                    where: {
                        workspaceId: payment.workspaceId,
                        userId: payment.userId,
                    },
                    select: {
                        id: true,
                        workspace: { select: { timezone: true, type: true } },
                        subscriptions: {
                            where: currentSubscriptionWhere(now),
                            select: onlineGrantAbonementSelect,
                        },
                    },
                })
                if (!member) {
                    throw new BadRequestError({
                        message: 'Участник больше не состоит в клубе',
                    })
                }
                if (!payment.planId) {
                    throw new BadRequestError({
                        message: 'Тариф или событие удалены',
                    })
                }
                // Only abonements of the tariff's own scope collide with it.
                const planScope = await tx.planDirection.findMany({
                    where: { planId: payment.planId },
                    select: { directionId: true },
                })
                const start = onlineGrantStart(
                    sameScopeAbonements(
                        member.subscriptions,
                        planScope.map((d) => d.directionId),
                    ),
                    member.workspace.timezone,
                    now,
                    vocabularyForWorkspaceType(member.workspace.type),
                )
                if (start.kind === 'blocked') {
                    throw new BadRequestError({ message: start.message })
                }
                const result = await this.subscriptions.grantFromPlanInTx(tx, {
                    workspaceId: payment.workspaceId,
                    workspaceMemberId: member.id,
                    planId: payment.planId,
                    startDate:
                        start.kind === 'renewal' ? start.startDate : undefined,
                    now,
                    amountPaid: payment.amount,
                    ...priceFacts(payment),
                    pricedById: null,
                    paid: true,
                    source: 'GATEWAY',
                    provider: payment.provider.toLowerCase(),
                    externalPaymentId: payment.providerPaymentId,
                })
                await tx.payment.update({
                    where: { id: payment.id },
                    data: { subscriptionId: result.subscription.id },
                })
                // Member autopay, committed with the grant: the setup creates
                // (or re-arms) the agreement, a renewal resets its attempts.
                const setup = isSetup
                    ? await this.autopay.setUpFromPaymentInTx(
                          tx,
                          payment,
                          gateway,
                          result.subscription,
                          now,
                      )
                    : null
                const afterCancel = isRenewal
                    ? (await this.autopay.onChargeSucceededInTx(tx, payment, now)) === 'cancelled'
                    : false
                return {
                    subscriptionId: result.subscription.id,
                    planName: result.subscription.plan.name,
                    accessUntil: result.accessUntil,
                    timezone: member.workspace.timezone,
                    sub: result.subscription,
                    setup,
                    afterCancel,
                }
            })
        } catch (err) {
            if (
                !(err instanceof BadRequestError) &&
                !(err instanceof NotFoundError)
            ) {
                throw err
            }
            return this.recordUnactivated(payment, now, err.message)
        }
        if (!granted) return 'unchanged'

        await this.audit.record({
            action: 'payment.succeeded',
            targetType: 'member',
            targetId: payment.userId,
            workspaceId: payment.workspaceId,
            actorId: payment.userId,
            metadata: {
                paymentId: payment.id,
                provider: payment.provider,
                planName: granted.planName,
                amount: payment.amount,
                currency: payment.currency,
                ...priceFacts(payment),
                subscriptionId: granted.subscriptionId,
                accessUntil: granted.accessUntil
                    ? granted.accessUntil.toISOString()
                    : null,
                ...(isRenewal ? { autopayId: payment.autopayId, autopay: 'charge' } : {}),
                ...(granted.setup ? { autopayId: granted.setup.autopayId, autopay: 'setup' } : {}),
            },
        })
        if (granted.setup) await this.autopay.announceSetUp(payment, granted.setup)
        // The member cancelled while the charge was at the provider: staff
        // decide on a refund.
        if (granted.afterCancel) await this.autopay.alertChargedAfterCancel(payment)
        this.realtime.invalidate(payment.workspaceId, [
            'members',
            'subscription',
            'payments',
        ])
        await this.notifyMember(payment, {
            topic: isRenewal ? 'Автоплатёж прошёл' : 'Оплата прошла',
            message: this.grantedText(payment, granted, isSetup, isRenewal),
        })
        return 'activated'
    }

    // The member's push after a grant (docs/design/2026-11-15-member-autopay.md
    // §3.6): a plain sale, a setup (saved or not), or a renewal charge.
    private grantedText(
        payment: PaymentRow,
        granted: {
            planName: string
            timezone: string
            sub: {
                startDate: Date | null
                endDate: Date | null
                classesTotal: number | null
                classesRemaining: number | null
            }
            setup: AutopaySetup | null
            afterCancel: boolean
        },
        isSetup: boolean,
        isRenewal: boolean,
    ): string {
        const tz = granted.timezone
        if (isRenewal) {
            const until = granted.sub.endDate
                ? ` Действует до ${formatRuDate(granted.sub.endDate, tz)}.`
                : ''
            if (granted.afterCancel) {
                return `Списание ${formatMoney(payment.amount, payment.currency)} за абонемент «${granted.planName}» началось до того, как вы отключили автоплатёж, и прошло. Абонемент оформлен.${until} Если он вам не нужен, обратитесь в клуб с просьбой о возврате. Новых списаний не будет.`
            }
            return `Автоплатёж: списали ${formatMoney(payment.amount, payment.currency)} за абонемент «${granted.planName}».${until}`
        }
        if (!isSetup) return `Абонемент «${granted.planName}» оформлен. Спасибо!`
        if (!granted.setup) {
            return `Абонемент «${granted.planName}» оформлен. Автоплатёж не подключился — платёжная система не сохранила карту.`
        }
        const next = autopayNextChargeOn(granted.sub, tz, null)
        const day = next ? formatRuDate(new Date(`${next.on}T00:00:00Z`), 'UTC') : null
        const when = !day
            ? 'после начала абонемента'
            : next?.kind === 'pack'
              ? `когда закончатся занятия, не позже ${day}`
              : day
        return `Абонемент «${granted.planName}» оформлен. Автоплатёж включён: следующее списание — ${when}, ${formatMoney(granted.setup.termsAmount, granted.setup.currency)}.`
    }

    // The money is in but the grant was refused: keep the payment SUCCEEDED
    // (it is the truth) with the reason, so the payments page shows it to
    // staff, and the provider stops retrying the webhook.
    private async recordUnactivated(
        payment: PaymentRow,
        now: Date,
        reason: string,
    ): Promise<ProviderStatusOutcome> {
        const marked = await this.prisma.payment.updateMany({
            where: { id: payment.id, status: 'PENDING' },
            data: {
                status: 'SUCCEEDED',
                paidAt: now,
                activationError: reason.slice(0, 500),
            },
        })
        if (marked.count !== 1) return 'unchanged'
        this.logger.warn(
            `Payment ${payment.id} succeeded but the abonement was not created: ${reason}`,
        )
        await this.audit.record({
            action: 'payment.succeeded',
            targetType: 'member',
            targetId: payment.userId,
            workspaceId: payment.workspaceId,
            actorId: payment.userId,
            metadata: {
                paymentId: payment.id,
                provider: payment.provider,
                planName: payment.planName,
                amount: payment.amount,
                currency: payment.currency,
                activationError: reason,
                ...(payment.autopayId && !payment.autopayConsentVersion
                    ? { autopayId: payment.autopayId, autopay: 'charge' }
                    : {}),
            },
        })
        this.realtime.invalidate(payment.workspaceId, ['payments'])
        // A renewal charge that could not be granted stops its agreement and
        // alerts staff; a setup that isn't granted makes no agreement.
        if (payment.autopayId && !payment.autopayConsentVersion) {
            await this.autopay.onGrantRefused(payment, reason)
        }
        await this.notifyMember(payment, {
            topic: 'Оплата получена',
            message: `Оплата за «${payment.planName}» получена. Абонемент оформит администратор клуба — мы ему сообщили.`,
        })
        return 'paid-not-activated'
    }

    // Best-effort: a failed push never fails the webhook (the provider would
    // retry it, and the claim above already makes the retry a no-op). A
    // ticket's push is not tied to the abonement section; `eventRegistrationId`
    // in the metadata routes it to the events screen.
    private async notifyMember(
        payment: PaymentRow,
        text: { topic: string; message: string },
    ) {
        try {
            await this.notifications.notifyUser({
                userId: payment.userId,
                kind: 'payment.succeeded',
                refId: payment.id,
                topic: text.topic,
                message: text.message,
                metadata: payment.eventRegistrationId
                    ? {
                          paymentId: payment.id,
                          eventRegistrationId: payment.eventRegistrationId,
                      }
                    : { paymentId: payment.id },
                workspaceId: payment.workspaceId,
                ...(payment.eventRegistrationId ? {} : { feature: 'subscription' as const }),
            })
        } catch (err) {
            this.logger.warn(
                `Payment notification failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }
}
