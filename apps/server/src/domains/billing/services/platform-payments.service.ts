import { randomUUID } from 'crypto'

import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import {
    type PlatformPayment,
    Prisma,
    PrismaService,
} from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { escapeHtml } from '../../../shared/utils/escape-html'
import { AuditService } from '../../audit/services/audit.service'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { PaymentGatewayClient } from '../../payments/payment-gateway.client'
import {
    type GatewayCredentials,
    type GatewayPayment,
    PaymentGatewayError,
    toMinorUnits,
} from '../../payments/payment-gateway.types'
import {
    addMonths,
    AUTOPAY_LEAD_MS,
    autopayRetryAt,
    moduleConnectPrice,
    paidPeriodStart,
} from '../billing-rules'
import { isPaidModuleActive } from '../module-entitlement'
import { platformGatewayCredentials } from '../platform-payment-credentials'
import {
    modulePricing,
    type PlatformModuleCode,
} from '../platform-pricing.config'
import type { QuoteLine, WorkspaceQuote } from '../quote-workspace-billing'
import { PlatformBillingService } from './platform-billing.service'

export type PlatformPaymentRow = PlatformPayment

// The quote as charged, frozen on the payment row.
export type PlatformPaymentLines = {
    lines: QuoteLine[]
    discounts: QuoteLine[]
    subtotal: number
    discount: number
    total: number
}

export type ApplyOutcome = 'applied' | 'failed' | 'unchanged'

export type RenewalOutcome =
    // Charged and the period extended.
    | 'CHARGED'
    // The bill was 0 (comp / free period): extended without a charge.
    | 'EXTENDED_FREE'
    // The provider is still processing; the webhook finishes it.
    | 'PENDING'
    // The card was refused; the owner was told, a retry is scheduled.
    | 'FAILED'
    // Nothing to do (not due, no card, autopay off, already charged…).
    | 'SKIPPED'

export type ModuleChangeOutcome =
    | 'CONNECTED'
    | 'PAYMENT_REQUIRED'
    | 'PAYMENT_PENDING'
    | 'RESTORED'
    | 'DISCONNECTED'
    | 'DISCONNECT_SCHEDULED'

export const PLATFORM_PAYMENTS_UNAVAILABLE =
    'Оплата картой пока недоступна — напишите нам, выставим счёт'
const PROVIDER_FAILED = 'Не удалось создать платёж. Попробуйте позже'

// A repeated «Оплатить» within this window gets the same payment page.
const PENDING_REUSE_MS = 30 * 60 * 1000
// A charge still processing at the provider blocks a second one this long
// (YooKassa settles a saved-card charge within minutes; a payer's page
// expires on its own).
const OWNER_INFLIGHT_MS = 60 * 60 * 1000
const AUTOPAY_INFLIGHT_MS = 3 * 24 * 60 * 60 * 1000
// A renewal row with no provider answer yet is re-sent (same key) only after
// this long; a younger one is still being sent by another run.
const RESEND_AFTER_MS = 10 * 60 * 1000

// YooKassa cancellation_details.reason → what the owner is told.
const DECLINE_REASON_RU: Record<string, string> = {
    insufficient_funds: 'на карте недостаточно средств',
    card_expired: 'истёк срок действия карты',
    permission_revoked: 'карта отвязана — автосписание по ней больше невозможно',
    payment_method_restricted: 'операции по карте ограничены банком',
    payment_method_limit_exceeded: 'превышен лимит операций по карте',
    issuer_unavailable: 'банк карты не ответил',
    fraud_suspected: 'банк заподозрил мошенничество',
    general_decline: 'банк отклонил платёж',
    country_forbidden: 'карты этой страны не принимаются',
}

export const declineReasonRu = (reason: string | null | undefined): string =>
    (reason && DECLINE_REASON_RU[reason]) || 'платёж отклонён'

const RUB = new Intl.NumberFormat('ru-RU')
const DATE = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
})

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002'

const snapshot = (q: Pick<WorkspaceQuote, keyof PlatformPaymentLines>) =>
    ({
        lines: q.lines,
        discounts: q.discounts,
        subtotal: q.subtotal,
        discount: q.discount,
        total: q.total,
    }) satisfies PlatformPaymentLines as unknown as Prisma.InputJsonValue

// Card payments from clubs to ClubSpace through the platform's own YooKassa
// shop: the owner's checkout (saving the card), the pro-rata charge of a
// module connected mid-period, autopay renewals of the saved card, refunds
// from the console. One rule for every success, whichever path reports it
// (webhook, re-read on return, the synchronous answer of a saved-card
// charge): the PENDING row is claimed with a compare-and-set in the same
// transaction that extends the period — a duplicate report changes nothing.
// Every charge carries the row's idempotenceKey as the provider's
// Idempotence-Key, so a retried request is the same payment.
@Injectable()
export class PlatformPaymentsService {
    private readonly logger = new Logger(PlatformPaymentsService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly billing: PlatformBillingService,
        private readonly gateway: PaymentGatewayClient,
        private readonly audit: AuditService,
        private readonly producer: NotificationProducerService,
        private readonly notifications: NotificationsService,
    ) {}

    private credentials(): GatewayCredentials {
        const creds = platformGatewayCredentials()
        if (!creds) {
            throw new BadRequestError({ message: PLATFORM_PAYMENTS_UNAVAILABLE })
        }
        return creds
    }

    private billingPageUrl(workspaceId: string, paymentId?: string): string | null {
        if (!environment.adminUrl) return null
        const base = `${environment.adminUrl.replace(/\/+$/, '')}/workspace/${workspaceId}/billing`
        return paymentId ? `${base}?payment=${paymentId}` : base
    }

    private async loadClub(workspaceId: string) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, name: true, ownerId: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const owner = await this.prisma.user.findUnique({
            where: { id: workspace.ownerId },
            select: { email: true },
        })
        return { ...workspace, ownerEmail: owner?.email ?? null }
    }

    async list(workspaceId: string, take = 50): Promise<PlatformPaymentRow[]> {
        return this.prisma.platformPayment.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            take,
        })
    }

    // ─── Owner checkout ─────────────────────────────────────────────────

    // The club's choice of monthly or annual payment, for the checkout and
    // every renewal after it. Audited when it changes.
    async setBillingPeriod(p: {
        workspaceId: string
        periodMonths: number
        actorId: string
    }) {
        const current = await this.billing.getBilling(p.workspaceId)
        if (current.billingPeriodMonths === p.periodMonths) return current
        const updated = await this.prisma.workspaceBilling.update({
            where: { workspaceId: p.workspaceId },
            data: { billingPeriodMonths: p.periodMonths },
        })
        await this.audit.record({
            action: 'workspace.billingPeriod',
            targetType: 'workspace',
            targetId: p.workspaceId,
            workspaceId: p.workspaceId,
            actorId: p.actorId,
            metadata: { from: current.billingPeriodMonths, to: p.periodMonths },
        })
        return updated
    }

    // The club pays its next period (1 or 12 months — also its billing period
    // from now on) on YooKassa's page; YooKassa keeps the card for renewals.
    async startCheckout(p: {
        workspaceId: string
        periodMonths: number
        actorId: string
        now?: Date
    }): Promise<{ payment: PlatformPaymentRow; confirmationUrl: string }> {
        const creds = this.credentials()
        const now = p.now ?? new Date()
        const club = await this.loadClub(p.workspaceId)
        const current = await this.setBillingPeriod(p)

        const periodStart = paidPeriodStart(current, now)
        const quote = await this.billing.quoteWorkspaceBilling(p.workspaceId, {
            periodStart,
            periodMonths: p.periodMonths,
            now,
        })
        if (quote.total <= 0) {
            throw new BadRequestError({
                message: 'Оплачивать нечего: следующий период бесплатный',
            })
        }

        // A repeated tap (or an owner back from YooKassa without paying) gets
        // the same page instead of a second payment.
        const recent = await this.prisma.platformPayment.findFirst({
            where: {
                workspaceId: p.workspaceId,
                kind: 'PERIOD',
                initiator: 'OWNER',
                status: 'PENDING',
                periodMonths: p.periodMonths,
                amount: quote.total,
                confirmationUrl: { not: null },
                createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
            },
            orderBy: { createdAt: 'desc' },
        })
        if (recent?.confirmationUrl) {
            return { payment: recent, confirmationUrl: recent.confirmationUrl }
        }

        if (!club.ownerEmail) {
            throw new BadRequestError({
                message: 'У владельца клуба нет e-mail для чека',
            })
        }
        const payment = await this.prisma.platformPayment.create({
            data: {
                workspaceId: p.workspaceId,
                kind: 'PERIOD',
                initiator: 'OWNER',
                periodMonths: p.periodMonths,
                periodStart,
                periodEnd: addMonths(periodStart, p.periodMonths),
                amount: quote.total,
                currency: quote.currency,
                lines: snapshot(quote),
                tierCode: quote.tierCode,
                provider: creds.provider,
                idempotenceKey: randomUUID(),
                receiptEmail: club.ownerEmail,
            },
        })
        return this.sendRedirectPayment(creds, payment, {
            clubName: club.name,
            itemName: `Подписка ClubSpace, ${p.periodMonths} мес.`,
        })
    }

    // A redirect payment for a PENDING row; on any failure the row is
    // canceled and the payer gets PROVIDER_FAILED.
    private async sendRedirectPayment(
        creds: GatewayCredentials,
        payment: PlatformPaymentRow,
        text: { clubName: string; itemName: string },
    ): Promise<{ payment: PlatformPaymentRow; confirmationUrl: string }> {
        const returnUrl = this.billingPageUrl(payment.workspaceId, payment.id)
        let created: GatewayPayment | null = null
        if (!returnUrl) {
            this.logger.error('ADMIN_URL is not set: no return URL for platform payments')
        } else {
            try {
                created = await this.gateway.createPayment(creds, {
                    paymentId: payment.id,
                    workspaceId: payment.workspaceId,
                    idempotenceKey: payment.idempotenceKey,
                    amount: payment.amount,
                    currency: payment.currency,
                    description: `ClubSpace — ${text.itemName} — ${text.clubName}`,
                    itemName: text.itemName,
                    returnUrl,
                    customerEmail: payment.receiptEmail ?? '',
                    savePaymentMethod: true,
                })
            } catch (err) {
                if (!(err instanceof PaymentGatewayError)) throw err
                this.logger.warn(
                    `Platform payment ${payment.id} not created: ${err.message}${
                        err.providerMessage ? ` (${err.providerMessage})` : ''
                    }`,
                )
            }
        }
        if (!created?.confirmationUrl) {
            await this.prisma.platformPayment.update({
                where: { id: payment.id },
                data: {
                    status: 'CANCELED',
                    providerPaymentId: created?.providerPaymentId ?? null,
                    failureReason: 'Платёж не создан',
                },
            })
            throw new BadRequestError({ message: PROVIDER_FAILED })
        }
        const saved = await this.prisma.platformPayment.update({
            where: { id: payment.id },
            data: {
                providerPaymentId: created.providerPaymentId,
                confirmationUrl: created.confirmationUrl,
            },
        })
        return { payment: saved, confirmationUrl: created.confirmationUrl }
    }

    // ─── Provider reports ───────────────────────────────────────────────

    // The owner came back from YooKassa: re-read a still-pending payment so
    // the page is right even before the webhook lands.
    async refresh(workspaceId: string, paymentId: string): Promise<PlatformPaymentRow> {
        const payment = await this.prisma.platformPayment.findFirst({
            where: { id: paymentId, workspaceId },
        })
        if (!payment) throw new NotFoundError({ message: 'Платёж не найден' })
        if (payment.status !== 'PENDING' || !payment.providerPaymentId) {
            return payment
        }
        const creds = platformGatewayCredentials()
        if (!creds) return payment
        try {
            const gateway = await this.gateway.getPayment(
                creds,
                payment.providerPaymentId,
            )
            if (gateway.providerPaymentId === payment.providerPaymentId) {
                await this.applyGateway(gateway)
            }
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(`Re-read of platform payment ${payment.id} failed: ${err.message}`)
        }
        return this.prisma.platformPayment.findUniqueOrThrow({
            where: { id: payment.id },
        })
    }

    // Applies the provider's (verified) view of one of our payments.
    async applyGateway(gateway: GatewayPayment, now: Date = new Date()): Promise<ApplyOutcome> {
        const payment = await this.prisma.platformPayment.findUnique({
            where: { providerPaymentId: gateway.providerPaymentId },
        })
        if (!payment) return 'unchanged'
        if (gateway.status === 'CANCELED') {
            return (await this.markFailed(
                payment,
                gateway.cancellationReason ?? null,
                now,
            ))
                ? 'failed'
                : 'unchanged'
        }
        if (gateway.status !== 'SUCCEEDED') return 'unchanged'

        // YooKassa must have taken exactly what we asked for.
        const expected = toMinorUnits(payment.amount, payment.currency)
        if (
            gateway.amountMinor !== expected ||
            gateway.currency?.toUpperCase() !== payment.currency.toUpperCase()
        ) {
            this.logger.error(
                `Platform payment ${payment.id}: provider reports ${gateway.amountMinor} ${gateway.currency}, expected ${expected} ${payment.currency} — not applied`,
            )
            return 'unchanged'
        }
        return (await this.markSucceeded(payment, gateway, now))
            ? 'applied'
            : 'unchanged'
    }

    // PENDING → SUCCEEDED and its effect, in one transaction. false = already
    // handled by an earlier or concurrent report.
    private async markSucceeded(
        payment: PlatformPaymentRow,
        gateway: GatewayPayment | null,
        now: Date,
    ): Promise<boolean> {
        const method = gateway?.paymentMethod ?? null
        const savedMethod =
            method?.saved && method.id
                ? {
                      paymentMethodId: method.id,
                      paymentMethodTitle: method.title?.slice(0, 64) ?? null,
                      paymentMethodCardLast4: method.cardLast4?.slice(0, 4) ?? null,
                      paymentMethodSavedAt: now,
                  }
                : {}
        const applied = await this.prisma.$transaction(async (tx) => {
            const claimed = await tx.platformPayment.updateMany({
                where: { id: payment.id, status: 'PENDING' },
                data: {
                    status: 'SUCCEEDED',
                    paidAt: now,
                    cardLast4: method?.cardLast4?.slice(0, 4) ?? null,
                    cardTitle: method?.title?.slice(0, 64) ?? null,
                },
            })
            if (claimed.count !== 1) return null
            const row = await tx.workspaceBilling.findUniqueOrThrow({
                where: { workspaceId: payment.workspaceId },
            })

            if (payment.kind === 'MODULE') {
                if (payment.module) {
                    await this.setModulePaid(tx, payment.workspaceId, payment.module)
                }
                if (Object.keys(savedMethod).length > 0) {
                    await tx.workspaceBilling.update({
                        where: { workspaceId: payment.workspaceId },
                        data: savedMethod,
                    })
                }
                return { from: row.status, to: row.status, periodEnd: row.currentPeriodEnd }
            }

            const start = paidPeriodStart(row, now)
            const end = addMonths(start, payment.periodMonths)
            // Paid during the trial: the trial runs on, the paid period
            // follows it (nextBillingTransition).
            const stillTrial =
                row.status === 'TRIAL' && row.trialEndsAt !== null && row.trialEndsAt > now
            await tx.workspaceBilling.update({
                where: { workspaceId: payment.workspaceId },
                data: {
                    status: stillTrial ? 'TRIAL' : 'ACTIVE',
                    currentPeriodEnd: end,
                    pastDueSince: null,
                    paidTierCode: payment.tierCode ?? row.paidTierCode,
                    setupFeePaidAt: row.setupFeePaidAt ?? now,
                    autopayFailedAttempts: 0,
                    autopayNextAttemptAt: null,
                    autopayLastError: null,
                    ...savedMethod,
                },
            })
            await tx.platformPayment.update({
                where: { id: payment.id },
                data: { periodStart: start, periodEnd: end },
            })
            return {
                from: row.status,
                to: stillTrial ? 'TRIAL' : 'ACTIVE',
                periodEnd: end,
            }
        })
        if (!applied) return false

        await this.audit.record({
            action: 'workspace.billingPayment',
            targetType: 'workspace',
            targetId: payment.workspaceId,
            workspaceId: payment.workspaceId,
            actorId: null,
            metadata: {
                paymentId: payment.id,
                kind: payment.kind,
                initiator: payment.initiator,
                module: payment.module,
                amount: payment.amount,
                currency: payment.currency,
                periodMonths: payment.periodMonths,
                from: applied.from,
                to: applied.to,
                currentPeriodEnd: applied.periodEnd?.toISOString() ?? null,
                cardSaved: Object.keys(savedMethod).length > 0,
            },
        })
        return true
    }

    // PENDING → CANCELED. A refused renewal also counts the failure, schedules
    // the retry and tells the owner. false = already handled.
    private async markFailed(
        payment: PlatformPaymentRow,
        reason: string | null,
        now: Date,
    ): Promise<boolean> {
        const marked = await this.prisma.platformPayment.updateMany({
            where: { id: payment.id, status: 'PENDING' },
            data: {
                status: 'CANCELED',
                failureReason: (reason ?? 'canceled').slice(0, 500),
            },
        })
        if (marked.count !== 1) return false
        if (payment.kind === 'PERIOD' && payment.initiator !== 'OWNER') {
            await this.recordRenewalFailure(payment, reason, now)
        }
        return true
    }

    private async recordRenewalFailure(
        payment: PlatformPaymentRow,
        reason: string | null,
        now: Date,
    ) {
        const row = await this.prisma.workspaceBilling.update({
            where: { workspaceId: payment.workspaceId },
            data: {
                autopayFailedAttempts: { increment: 1 },
                autopayLastError: declineReasonRu(reason).slice(0, 500),
                // A card the payer unlinked can never be charged again.
                ...(reason === 'permission_revoked'
                    ? {
                          paymentMethodId: null,
                          paymentMethodTitle: null,
                          paymentMethodCardLast4: null,
                          paymentMethodSavedAt: null,
                      }
                    : {}),
            },
        })
        const nextAttemptAt =
            row.paymentMethodId !== null
                ? autopayRetryAt(now, row.autopayFailedAttempts)
                : null
        await this.prisma.workspaceBilling.update({
            where: { workspaceId: payment.workspaceId },
            data: { autopayNextAttemptAt: nextAttemptAt },
        })
        await this.audit.record({
            action: 'workspace.billingChargeFailed',
            targetType: 'workspace',
            targetId: payment.workspaceId,
            workspaceId: payment.workspaceId,
            actorId: null,
            metadata: {
                paymentId: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                reason,
                attempt: row.autopayFailedAttempts,
                nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
            },
        })
        await this.notifyChargeFailed(payment, reason, nextAttemptAt)
    }

    // E-mail + push to the owner after each refused renewal. Best-effort: a
    // failed notification never undoes the bookkeeping above.
    private async notifyChargeFailed(
        payment: PlatformPaymentRow,
        reason: string | null,
        nextAttemptAt: Date | null,
    ) {
        try {
            const club = await this.loadClub(payment.workspaceId)
            const link = this.billingPageUrl(payment.workspaceId)
            const topic = `Не удалось списать оплату ClubSpace — «${club.name}»`
            const retry = nextAttemptAt
                ? `Повторим ${DATE.format(nextAttemptAt)}.`
                : 'Автосписание по этой карте больше невозможно.'
            const text = `Не прошло автосписание ${RUB.format(payment.amount)} ₽ за подписку клуба «${club.name}»: ${declineReasonRu(reason)}. ${retry} Проверьте карту или оплатите на странице «Тариф».`
            await this.producer.notifyUser({
                userId: club.ownerId,
                kind: 'platformBilling.chargeFailed',
                refId: payment.id,
                topic,
                message: text,
                link,
                metadata: { workspaceId: payment.workspaceId, paymentId: payment.id },
            })
            if (club.ownerEmail) {
                await this.notifications.sendNotification({
                    userId: club.ownerId,
                    type: 'EMAIL',
                    identity: club.ownerEmail,
                    topic,
                    message: `<p>${escapeHtml(text)}</p>${
                        link ? `<p><a href="${escapeHtml(link)}">Открыть «Тариф»</a></p>` : ''
                    }`,
                    metadata: {
                        kind: 'platformBilling.chargeFailed',
                        workspaceId: payment.workspaceId,
                        paymentId: payment.id,
                    },
                })
            }
        } catch (err) {
            this.logger.warn(
                `Charge-failed notification for ${payment.id} failed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }

    // ─── Saved-card charges ─────────────────────────────────────────────

    // Charges the saved card for a PENDING row and applies the answer. A
    // network error or a 5xx leaves the row PENDING without a provider id: the
    // next attempt re-sends the same Idempotence-Key, so YooKassa answers with
    // the same payment instead of charging twice.
    private async chargeSavedCard(
        creds: GatewayCredentials,
        payment: PlatformPaymentRow,
        paymentMethodId: string,
        text: { clubName: string; itemName: string },
        now: Date,
    ): Promise<'SUCCEEDED' | 'PENDING' | 'CANCELED' | 'ERROR'> {
        let gateway: GatewayPayment
        try {
            gateway = await this.gateway.createPayment(creds, {
                paymentId: payment.id,
                workspaceId: payment.workspaceId,
                idempotenceKey: payment.idempotenceKey,
                amount: payment.amount,
                currency: payment.currency,
                description: `ClubSpace — ${text.itemName} — ${text.clubName}`,
                itemName: text.itemName,
                returnUrl: this.billingPageUrl(payment.workspaceId) ?? '',
                customerEmail: payment.receiptEmail ?? '',
                paymentMethodId,
            })
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(
                `Saved-card charge ${payment.id} failed: ${err.message}${
                    err.providerMessage ? ` (${err.providerMessage})` : ''
                }`,
            )
            if (err.status === null || err.status >= 500) return 'ERROR'
            // The provider refused the request itself (e.g. the method is
            // no longer usable): a refusal like any other.
            await this.markFailed(payment, err.providerMessage ?? 'refused', now)
            return 'CANCELED'
        }
        await this.prisma.platformPayment.update({
            where: { id: payment.id },
            data: { providerPaymentId: gateway.providerPaymentId },
        })
        const outcome = await this.applyGateway(gateway, now)
        if (gateway.status === 'SUCCEEDED' && outcome !== 'unchanged') return 'SUCCEEDED'
        if (gateway.status === 'CANCELED') return 'CANCELED'
        return gateway.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING'
    }

    // ─── Renewal ────────────────────────────────────────────────────────

    // Renews one club's period when it is due: ACTIVE within AUTOPAY_LEAD_MS
    // of its end, or PAST_DUE (and SUSPENDED when the console retries). A bill
    // of 0 extends the period without a provider call; otherwise the saved
    // card is charged once per period and attempt — the row's idempotenceKey
    // is derived from both, so a second run (or replica) finds it taken.
    async renew(
        workspaceId: string,
        opts: { initiator: 'AUTOPAY' | 'PLATFORM'; now?: Date },
    ): Promise<{ outcome: RenewalOutcome; reason: string | null; payment: PlatformPaymentRow | null }> {
        const now = opts.now ?? new Date()
        const skip = (reason: string) => ({ outcome: 'SKIPPED' as const, reason, payment: null })
        if (!this.billing.enabled) return skip('Платёжный модуль выключен')
        const row = await this.prisma.workspaceBilling.findUnique({ where: { workspaceId } })
        if (!row) return skip('Нет подписки')
        const due =
            (row.status === 'ACTIVE' &&
                row.currentPeriodEnd !== null &&
                row.currentPeriodEnd.getTime() - AUTOPAY_LEAD_MS <= now.getTime()) ||
            row.status === 'PAST_DUE' ||
            (row.status === 'SUSPENDED' && opts.initiator === 'PLATFORM')
        if (!due) return skip('Срок оплаты ещё не наступил')

        const start = paidPeriodStart(row, now)
        // What the charge is for, stable across runs: the end of the period
        // being renewed (or when the club went overdue).
        const anchor =
            (row.status === 'ACTIVE' ? row.currentPeriodEnd : row.pastDueSince) ??
            row.currentPeriodEnd ??
            row.trialEndsAt
        const anchorKey = anchor?.toISOString() ?? 'none'
        const quote = await this.billing.quoteWorkspaceBilling(workspaceId, {
            periodStart: start,
            now,
        })
        if (quote.total <= 0) return this.extendFree(row, quote, start, anchorKey, opts.initiator, now)

        if (!row.autopayEnabled && opts.initiator === 'AUTOPAY') return skip('Автосписание выключено')
        if (!row.paymentMethodId) return skip('Нет сохранённой карты')
        const creds = platformGatewayCredentials()
        if (!creds) return skip(PLATFORM_PAYMENTS_UNAVAILABLE)

        const idempotenceKey = `renewal:${workspaceId}:${anchorKey}:${row.autopayFailedAttempts}`
        // An owner's checkout or an earlier charge still in flight: let it
        // settle rather than charge twice.
        const inflight = await this.prisma.platformPayment.findFirst({
            where: {
                workspaceId,
                kind: 'PERIOD',
                status: 'PENDING',
                idempotenceKey: { not: idempotenceKey },
                OR: [
                    {
                        initiator: 'OWNER',
                        createdAt: { gte: new Date(now.getTime() - OWNER_INFLIGHT_MS) },
                    },
                    {
                        initiator: { not: 'OWNER' },
                        providerPaymentId: { not: null },
                        createdAt: { gte: new Date(now.getTime() - AUTOPAY_INFLIGHT_MS) },
                    },
                ],
            },
            select: { id: true },
        })
        if (inflight) return skip('Предыдущий платёж ещё обрабатывается')

        const club = await this.loadClub(workspaceId)
        let payment = await this.prisma.platformPayment.findUnique({
            where: { idempotenceKey },
        })
        if (payment && (payment.status !== 'PENDING' || payment.providerPaymentId)) {
            return { outcome: 'SKIPPED', reason: 'Этот период уже списан', payment }
        }
        if (payment && payment.createdAt.getTime() > now.getTime() - RESEND_AFTER_MS) {
            return { outcome: 'SKIPPED', reason: 'Этот период уже списывается', payment: null }
        }
        if (!payment) {
            try {
                payment = await this.prisma.platformPayment.create({
                    data: {
                        workspaceId,
                        kind: 'PERIOD',
                        initiator: opts.initiator,
                        periodMonths: quote.periodMonths,
                        periodStart: start,
                        periodEnd: addMonths(start, quote.periodMonths),
                        amount: quote.total,
                        currency: quote.currency,
                        lines: snapshot(quote),
                        tierCode: quote.tierCode,
                        provider: creds.provider,
                        idempotenceKey,
                        receiptEmail: club.ownerEmail,
                        cardLast4: row.paymentMethodCardLast4,
                        cardTitle: row.paymentMethodTitle,
                    },
                })
            } catch (e) {
                if (!isP2002(e)) throw e
                return skip('Этот период уже списывается')
            }
        }

        const result = await this.chargeSavedCard(
            creds,
            payment,
            row.paymentMethodId,
            {
                clubName: club.name,
                itemName: `Подписка ClubSpace, ${payment.periodMonths} мес.`,
            },
            now,
        )
        const fresh = await this.prisma.platformPayment.findUniqueOrThrow({
            where: { id: payment.id },
        })
        switch (result) {
            case 'SUCCEEDED':
                return { outcome: 'CHARGED', reason: null, payment: fresh }
            case 'CANCELED':
                return { outcome: 'FAILED', reason: fresh.failureReason, payment: fresh }
            case 'PENDING':
                return { outcome: 'PENDING', reason: null, payment: fresh }
            case 'ERROR':
                return {
                    outcome: 'SKIPPED',
                    reason: 'Платёжная система не ответила — повторим',
                    payment: fresh,
                }
        }
    }

    // A period whose bill is 0 (comp, a free period, a 100% discount): a 0 ₽
    // row for the history and the period extended, both or neither; the row's
    // unique key makes a second run a no-op.
    private async extendFree(
        row: { id: string; workspaceId: string; status: string; currentPeriodEnd: Date | null },
        quote: WorkspaceQuote,
        start: Date,
        anchorKey: string,
        initiator: 'AUTOPAY' | 'PLATFORM',
        now: Date,
    ) {
        const end = addMonths(start, quote.periodMonths)
        let payment: PlatformPaymentRow | null
        try {
            payment = await this.prisma.$transaction(async (tx) => {
                const created = await tx.platformPayment.create({
                    data: {
                        workspaceId: row.workspaceId,
                        kind: 'PERIOD',
                        initiator,
                        periodMonths: quote.periodMonths,
                        periodStart: start,
                        periodEnd: end,
                        amount: 0,
                        currency: quote.currency,
                        lines: snapshot(quote),
                        tierCode: quote.tierCode,
                        status: 'SUCCEEDED',
                        paidAt: now,
                        idempotenceKey: `renewal:${row.workspaceId}:${anchorKey}:free`,
                    },
                })
                const moved = await tx.workspaceBilling.updateMany({
                    where: {
                        id: row.id,
                        status: row.status as 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED',
                        currentPeriodEnd: row.currentPeriodEnd,
                    },
                    data: {
                        status: 'ACTIVE',
                        currentPeriodEnd: end,
                        pastDueSince: null,
                        paidTierCode: quote.tierCode,
                        autopayFailedAttempts: 0,
                        autopayNextAttemptAt: null,
                        autopayLastError: null,
                    },
                })
                // Changed meanwhile (a console action, a payment): undo.
                if (moved.count !== 1) throw new ConcurrentChange()
                return created
            })
        } catch (e) {
            if (isP2002(e) || e instanceof ConcurrentChange) {
                return { outcome: 'SKIPPED' as const, reason: 'Период уже продлён', payment: null }
            }
            throw e
        }
        await this.audit.record({
            action: 'workspace.billingPayment',
            targetType: 'workspace',
            targetId: row.workspaceId,
            workspaceId: row.workspaceId,
            actorId: null,
            metadata: {
                paymentId: payment.id,
                kind: 'PERIOD',
                initiator,
                amount: 0,
                currency: quote.currency,
                periodMonths: quote.periodMonths,
                from: row.status,
                to: 'ACTIVE',
                currentPeriodEnd: end.toISOString(),
                free: true,
            },
        })
        return { outcome: 'EXTENDED_FREE' as const, reason: null, payment }
    }

    // ─── Modules ────────────────────────────────────────────────────────

    // Turns a module on for the club as PAID (the platform's custom price
    // stays), cancelling a scheduled disconnection.
    private async setModulePaid(
        tx: Pick<PrismaService, 'workspaceModuleEntitlement'>,
        workspaceId: string,
        module: PlatformModuleCode,
    ) {
        const where = { workspaceId, module }
        const { count } = await tx.workspaceModuleEntitlement.updateMany({
            where,
            data: { mode: 'PAID', compUntil: null, cancelAt: null },
        })
        if (count === 0) {
            await tx.workspaceModuleEntitlement.create({
                data: { ...where, mode: 'PAID' },
            })
        }
    }

    // The club connects or disconnects a paid module. The platform's settings
    // win: a module it switched off cannot be connected, a comp cannot be
    // disconnected. Connecting mid-period charges the rest of the period
    // (saved card, else YooKassa's page); disconnecting keeps the module, on
    // the bill, until the paid period ends.
    async setModule(p: {
        workspaceId: string
        module: PlatformModuleCode
        enabled: boolean
        actorId: string
        now?: Date
    }): Promise<{
        outcome: ModuleChangeOutcome
        payment: PlatformPaymentRow | null
        confirmationUrl: string | null
    }> {
        const now = p.now ?? new Date()
        if (!this.billing.enabled) {
            throw new BadRequestError({ message: 'На этой установке модули не оплачиваются' })
        }
        const club = await this.loadClub(p.workspaceId)
        const row = await this.billing.getBilling(p.workspaceId)
        const entitlement = await this.prisma.workspaceModuleEntitlement.findUnique({
            where: { workspaceId_module: { workspaceId: p.workspaceId, module: p.module } },
        })
        const config = modulePricing(this.billing.pricing, p.module)
        const done = async (outcome: ModuleChangeOutcome) => {
            await this.audit.record({
                action: 'workspace.moduleSelfServe',
                targetType: 'workspace',
                targetId: p.workspaceId,
                workspaceId: p.workspaceId,
                actorId: p.actorId,
                metadata: { module: p.module, outcome },
            })
            return { outcome, payment: null, confirmationUrl: null }
        }

        if (!p.enabled) {
            if (entitlement?.mode === 'COMP') {
                throw new BadRequestError({
                    message: `Модуль «${config.name}» предоставлен бесплатно — отключить его может только команда ClubSpace`,
                })
            }
            if (!entitlement || !isPaidModuleActive(entitlement, now)) {
                throw new BadRequestError({ message: `Модуль «${config.name}» не подключён` })
            }
            if (entitlement.cancelAt) {
                throw new BadRequestError({
                    message: `Модуль «${config.name}» уже отключится ${DATE.format(entitlement.cancelAt)}`,
                })
            }
            const paidAhead = row.currentPeriodEnd && row.currentPeriodEnd > now
            await this.prisma.workspaceModuleEntitlement.update({
                where: { id: entitlement.id },
                data: { cancelAt: paidAhead ? row.currentPeriodEnd : now },
            })
            return done(paidAhead ? 'DISCONNECT_SCHEDULED' : 'DISCONNECTED')
        }

        if (entitlement?.mode === 'OFF') {
            throw new BadRequestError({
                message: `Модуль «${config.name}» отключён командой ClubSpace — напишите нам, если он нужен`,
            })
        }
        if (entitlement?.mode === 'COMP' && entitlement.compUntil && entitlement.compUntil > now) {
            throw new BadRequestError({
                message: `Модуль «${config.name}» уже подключён бесплатно до ${DATE.format(entitlement.compUntil)}`,
            })
        }
        if (entitlement && isPaidModuleActive(entitlement, now)) {
            if (!entitlement.cancelAt) {
                throw new BadRequestError({ message: `Модуль «${config.name}» уже подключён` })
            }
            // Changed their mind before the period ended: already paid for.
            await this.prisma.workspaceModuleEntitlement.update({
                where: { id: entitlement.id },
                data: { cancelAt: null },
            })
            return done('RESTORED')
        }
        if (row.status === 'PAST_DUE' || row.status === 'SUSPENDED') {
            throw new BadRequestError({
                message: 'Сначала оплатите подписку — после этого модуль можно подключить',
            })
        }

        const price =
            entitlement?.mode === 'PAID' && entitlement.customPrice !== null
                ? entitlement.customPrice
                : config.priceMonthly
        const amount =
            moduleConnectPrice(
                row,
                price,
                this.billing.pricing.annualDiscountPercent,
                now,
            ) ?? 0
        if (amount <= 0) {
            // The trial, a free period, or no scheduled period: on the next bill.
            await this.setModulePaid(this.prisma, p.workspaceId, p.module)
            return done('CONNECTED')
        }

        const creds = this.credentials()
        const periodEnd = row.currentPeriodEnd!
        const recent = await this.prisma.platformPayment.findFirst({
            where: {
                workspaceId: p.workspaceId,
                kind: 'MODULE',
                module: p.module,
                status: 'PENDING',
                amount,
                confirmationUrl: { not: null },
                createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
            },
            orderBy: { createdAt: 'desc' },
        })
        if (recent?.confirmationUrl) {
            return {
                outcome: 'PAYMENT_REQUIRED',
                payment: recent,
                confirmationUrl: recent.confirmationUrl,
            }
        }
        if (!club.ownerEmail) {
            throw new BadRequestError({ message: 'У владельца клуба нет e-mail для чека' })
        }
        const title = `Модуль «${config.name}» до ${DATE.format(periodEnd)}`
        const payment = await this.prisma.platformPayment.create({
            data: {
                workspaceId: p.workspaceId,
                kind: 'MODULE',
                initiator: 'OWNER',
                module: p.module,
                periodMonths: row.billingPeriodMonths,
                periodStart: now,
                periodEnd,
                amount,
                currency: this.billing.pricing.currency,
                lines: snapshot({
                    lines: [{ code: `module:${p.module}`, title, amount }],
                    discounts: [],
                    subtotal: amount,
                    discount: 0,
                    total: amount,
                }),
                provider: creds.provider,
                idempotenceKey: randomUUID(),
                receiptEmail: club.ownerEmail,
                cardLast4: row.paymentMethodId ? (row.paymentMethodCardLast4 ?? null) : null,
                cardTitle: row.paymentMethodId ? (row.paymentMethodTitle ?? null) : null,
            },
        })
        const text = { clubName: club.name, itemName: `ClubSpace: ${title}` }

        if (row.paymentMethodId) {
            const result = await this.chargeSavedCard(
                creds,
                payment,
                row.paymentMethodId,
                text,
                now,
            )
            const fresh = await this.prisma.platformPayment.findUniqueOrThrow({
                where: { id: payment.id },
            })
            if (result === 'SUCCEEDED') {
                await done('CONNECTED')
                return { outcome: 'CONNECTED', payment: fresh, confirmationUrl: null }
            }
            if (result === 'PENDING') {
                return { outcome: 'PAYMENT_PENDING', payment: fresh, confirmationUrl: null }
            }
            if (result === 'ERROR') {
                await this.prisma.platformPayment.updateMany({
                    where: { id: payment.id, status: 'PENDING' },
                    data: { status: 'CANCELED', failureReason: 'Платёжная система не ответила' },
                })
                throw new BadRequestError({ message: PROVIDER_FAILED })
            }
            throw new BadRequestError({
                message: `Не удалось списать оплату с сохранённой карты: ${declineReasonRu(fresh.failureReason)}`,
            })
        }

        const created = await this.sendRedirectPayment(creds, payment, text)
        return { outcome: 'PAYMENT_REQUIRED', ...created }
    }

    // ─── Card & autopay ─────────────────────────────────────────────────

    // The owner removes the saved card: no more automatic charges.
    async removePaymentMethod(p: { workspaceId: string; actorId: string }) {
        const row = await this.billing.getBilling(p.workspaceId)
        if (!row.paymentMethodId) {
            throw new BadRequestError({ message: 'Сохранённой карты нет' })
        }
        await this.prisma.workspaceBilling.update({
            where: { workspaceId: p.workspaceId },
            data: {
                paymentMethodId: null,
                paymentMethodTitle: null,
                paymentMethodCardLast4: null,
                paymentMethodSavedAt: null,
                autopayNextAttemptAt: null,
            },
        })
        await this.audit.record({
            action: 'workspace.billingCardRemoved',
            targetType: 'workspace',
            targetId: p.workspaceId,
            workspaceId: p.workspaceId,
            actorId: p.actorId,
            metadata: { cardLast4: row.paymentMethodCardLast4 ?? null },
        })
    }

    // The console switches automatic renewal for a club.
    async setAutopay(p: { workspaceId: string; enabled: boolean; actorId: string }) {
        const row = await this.billing.getBilling(p.workspaceId)
        await this.prisma.workspaceBilling.update({
            where: { workspaceId: p.workspaceId },
            data: { autopayEnabled: p.enabled },
        })
        await this.audit.record({
            action: 'workspace.billingAutopay',
            targetType: 'workspace',
            targetId: p.workspaceId,
            workspaceId: p.workspaceId,
            actorId: p.actorId,
            metadata: { from: row.autopayEnabled ?? true, to: p.enabled },
        })
    }

    // ─── Refund (platform console) ──────────────────────────────────────

    // Full (amount omitted) or partial refund through YooKassa. The paid
    // period is left as is — shortening it is a separate console action.
    async refund(p: {
        workspaceId: string
        paymentId: string
        amount?: number
        reason?: string
        actorId: string
        now?: Date
    }): Promise<PlatformPaymentRow> {
        const payment = await this.prisma.platformPayment.findFirst({
            where: { id: p.paymentId, workspaceId: p.workspaceId },
        })
        if (!payment) throw new NotFoundError({ message: 'Платёж не найден' })
        if (payment.status === 'REFUNDED') {
            throw new BadRequestError({ message: 'Деньги по этому платежу уже возвращены' })
        }
        if (payment.status !== 'SUCCEEDED' || !payment.providerPaymentId || payment.amount <= 0) {
            throw new BadRequestError({ message: 'Вернуть можно только проведённый платёж картой' })
        }
        const remaining = payment.amount - payment.refundedAmount
        const amount = p.amount ?? remaining
        if (amount < 1 || amount > remaining) {
            throw new BadRequestError({
                message: `Вернуть можно от 1 до ${RUB.format(remaining)} ₽`,
            })
        }
        const creds = this.credentials()
        try {
            await this.gateway.refund(creds, {
                paymentId: payment.id,
                providerPaymentId: payment.providerPaymentId,
                amount,
                currency: payment.currency,
                // Stable per refund step: a retried click is the same refund.
                idempotenceKey: `platform-refund-${payment.id}-${payment.refundedAmount}-${amount}`,
            })
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(`Refund of platform payment ${payment.id} failed: ${err.message}`)
            throw new BadRequestError({
                message: `Платёжная система не провела возврат${
                    err.providerMessage ? `: ${err.providerMessage}` : ''
                }`,
            })
        }
        const refundedAmount = payment.refundedAmount + amount
        // Compare-and-set on the amount already refunded: two operators
        // pressing at once record one refund.
        const res = await this.prisma.platformPayment.updateMany({
            where: { id: payment.id, status: 'SUCCEEDED', refundedAmount: payment.refundedAmount },
            data: {
                refundedAmount,
                refundedAt: p.now ?? new Date(),
                status: refundedAmount >= payment.amount ? 'REFUNDED' : 'SUCCEEDED',
            },
        })
        if (res.count !== 1) {
            throw new BadRequestError({ message: 'Возврат по этому платежу уже записан' })
        }
        await this.audit.record({
            action: 'workspace.billingRefund',
            targetType: 'workspace',
            targetId: p.workspaceId,
            workspaceId: p.workspaceId,
            actorId: p.actorId,
            metadata: {
                paymentId: payment.id,
                amount,
                refundedTotal: refundedAmount,
                paymentAmount: payment.amount,
                currency: payment.currency,
                reason: p.reason?.trim() || null,
            },
        })
        return this.prisma.platformPayment.findUniqueOrThrow({ where: { id: payment.id } })
    }
}

class ConcurrentChange extends Error {}
