import { Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'

import { localDateInTz } from '../../features/attendance/attendance-utils'
import { PENDING_REUSE_MS } from '../../features/online-payments/load-buyer'
import { environment } from '../../environments/environment'
import {
    type Payment,
    type Prisma,
    PrismaService,
    type WorkspacePaymentSettings,
} from '../../infrastructure/prisma'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { suspensionReason } from '../billing/billing-rules'
import {
    isWorkspaceEntitled,
    moduleEntitlementSelect,
} from '../billing/module-entitlement'
import { onlineGrantStart, sameScopeAbonements } from '../payments/online-grant-start'
import { toGatewayCredentials } from '../payments/payment-credentials'
import { PaymentGatewayClient } from '../payments/payment-gateway.client'
import {
    type GatewayPayment,
    PaymentGatewayError,
    type ReceiptSettings,
} from '../payments/payment-gateway.types'
import {
    PaymentActivationService,
    type ProviderStatusOutcome,
} from '../payments/services/payment-activation.service'
import { scopeDirectionIds } from '../subscriptions/current-subscriptions'
import { type AutopayAbonementRow, lastUsedAt, loadAutopayAbonements } from './autopay-anchor'
import { AutopayNotificationsService } from './autopay-notifications'
import { autopayRenewalPrice } from './autopay-offer'
import {
    anchorCancelledByClub,
    autopayDueAt,
    autopayIdempotenceKey,
    inChargeWindow,
    pickAnchor,
    reminderAt,
    termsCheck,
} from './autopay-rules'
import { MemberAutopayAgreementsService } from './member-autopay-agreements.service'

export type AutopayChargeOutcome =
    // Charged and the new abonement granted.
    | 'CHARGED'
    // The provider is still processing; the webhook settles it.
    | 'PENDING'
    // Declined; counted, retried or stopped (MemberAutopayAgreementsService).
    | 'DECLINED'
    // Nothing to do now (not due, outside the window, already charged…).
    | 'SKIPPED'
    // Stopped until the member acts (terms changed, paid but not granted).
    | 'NEEDS_ACTION'
    // The safety net cancelled it (tariff / club / member gone, lapsed).
    | 'CANCELLED'

export type AutopayChargeResult = {
    outcome: AutopayChargeOutcome
    reason: string | null
    // A provider request was sent (counts against MAX_CHARGES_PER_RUN).
    sent?: boolean
}

// At most this many provider requests per pass; the rest wait an hour.
export const MAX_CHARGES_PER_RUN = 200

// failureReason of a period's row the pass dropped because the agreement was
// cancelled before the provider call (not a decline).
const CANCELLED_BEFORE_CHARGE = 'autopay cancelled before the charge'

// The provider request body of a renewal charge as first sent
// (Payment.chargeRequest). The saved card is not part of it: the token lives
// only on the agreement and dies with a cancel.
const ChargeRequestSchema = z.object({
    description: z.string(),
    itemName: z.string(),
    customerEmail: z.string(),
    returnUrl: z.string(),
    receipt: z.object({
        enabled: z.boolean(),
        vatCode: z.number(),
        paymentSubject: z.string(),
        paymentMode: z.string(),
        taxSystemCode: z.number().nullable().optional(),
    }),
})
type ChargeRequest = z.infer<typeof ChargeRequestSchema>

const receiptSettingsOf = (s: WorkspacePaymentSettings): ReceiptSettings => ({
    enabled: s.receiptEnabled,
    vatCode: s.vatCode,
    paymentSubject: s.paymentSubject,
    paymentMode: s.paymentMode,
})

type PaymentRecord = Payment

const outcomeOf = (
    applied: ProviderStatusOutcome,
    gateway: GatewayPayment,
): Pick<AutopayChargeResult, 'outcome' | 'reason'> => {
    switch (applied) {
        case 'activated':
            return { outcome: 'CHARGED', reason: null }
        case 'paid-not-activated':
            return { outcome: 'NEEDS_ACTION', reason: 'Оплачено, но абонемент не оформлен' }
        case 'canceled':
            return { outcome: 'DECLINED', reason: gateway.cancellationReason ?? null }
        case 'unchanged':
            return gateway.status === 'PENDING'
                ? { outcome: 'PENDING', reason: null }
                : { outcome: 'SKIPPED', reason: 'Ответ платёжной системы не применён' }
    }
}

// Candidates are read in pages of this size (by id).
const PAGE = 200
// A renewal row with no provider answer yet is re-sent (same key) only after
// this long; a younger one is still being sent by another run.
const RESEND_AFTER_MS = 10 * 60 * 1000
// ЮKassa keeps an Idempotence-Key for 24 h. A request sent earlier than this
// whose answer never arrived is not re-sent: past the key's life a re-send
// could charge the card a second time if the first one went through.
const RESEND_BEFORE_MS = 20 * 60 * 60 * 1000
// An earlier autopay charge still processing at the provider blocks the next.
const AUTOPAY_INFLIGHT_MS = 3 * 24 * 60 * 60 * 1000
const AUTOPAY_KEY_PREFIX = 'autopay:'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'

const skip = (reason: string): AutopayChargeResult => ({ outcome: 'SKIPPED', reason })

const agreementInclude = {
    plan: {
        select: {
            id: true,
            name: true,
            price: true,
            currency: true,
            durationDays: true,
            classCount: true,
            isActive: true,
            purchasableOnline: true,
            autopayAvailable: true,
            directions: { select: { directionId: true } },
        },
    },
    workspace: {
        select: {
            name: true,
            timezone: true,
            type: true,
            subscriptionEnabled: true,
            isActive: true,
            ...moduleEntitlementSelect('ONLINE_PAYMENTS'),
            paymentSettings: true,
        },
    },
    user: { select: { email: true } },
} as const satisfies Prisma.MemberAutopayInclude

// Statuses the pass looks at: ACTIVE, and the stops a new period can lift — a
// failed charge or a refused grant (a new anchor: staff sold the renewal, so
// the next period renews again) and changed terms (the price came back down).
// CARD_EXPIRED waits for a new card (a checkout with the switch on).
const PASS_WHERE = (now: Date) => ({
    OR: [
        { status: 'ACTIVE' as const },
        // Visited for the cancel checks only (lapse, tariff, club): an expired
        // card is never charged.
        { status: 'NEEDS_ACTION' as const, needsActionReason: 'CARD_EXPIRED' },
        {
            status: 'NEEDS_ACTION' as const,
            needsActionReason: { in: ['CHARGE_FAILED', 'GRANT_REFUSED', 'TERMS_CHANGED'] },
        },
    ],
    AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }],
})

// The hourly member autopay pass (docs/design/2026-11-15-member-autopay.md
// §3.2): charges each agreement whose renewal is due inside the club-local
// daytime window, and sends the 3-day / «one class left» reminders. Due times
// are derived each pass from the member's abonements (freezes, staff sales,
// check-ins and price edits are read as they are), and a charge is idempotent
// per renewed abonement and attempt — a repeated or overlapping run never
// charges twice. Runs with global concurrency 1 (MemberAutopayProcessor).
@Injectable()
export class MemberAutopayService {
    private readonly logger = new Logger(MemberAutopayService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
        private readonly activation: PaymentActivationService,
        private readonly agreements: MemberAutopayAgreementsService,
        private readonly notices: AutopayNotificationsService,
    ) {}

    async runCharges(
        now: Date = new Date(),
    ): Promise<Partial<Record<AutopayChargeOutcome, number>>> {
        const counts: Partial<Record<AutopayChargeOutcome, number>> = {}
        await this.reconcile(now)
        let sent = 0
        await this.forEachCandidate(PASS_WHERE(now), async (id) => {
            if (sent >= MAX_CHARGES_PER_RUN) return false
            try {
                const result = await this.chargeOne(id, now)
                counts[result.outcome] = (counts[result.outcome] ?? 0) + 1
                if (result.sent) sent++
            } catch (err) {
                this.logger.error(
                    `Autopay charge of ${id} failed`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
            return true
        })
        return counts
    }

    // Reminder notices sent (each once per agreement and renewed abonement).
    async runReminders(now: Date = new Date()): Promise<number> {
        let reminded = 0
        await this.forEachCandidate({ status: 'ACTIVE' }, async (id) => {
            try {
                reminded += await this.remindOne(id, now)
            } catch (err) {
                this.logger.error(
                    `Autopay reminder of ${id} failed`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
            return true
        })
        return reminded
    }

    // One agreement through the charge rules (design §3.2 `chargeOne`); every
    // refusal returns an outcome with a reason for logs and specs.
    async chargeOne(id: string, now: Date = new Date()): Promise<AutopayChargeResult> {
        const loaded = await this.load(id, now)
        if ('result' in loaded) return loaded.result
        const { agreement: a, plan, workspace, settings, anchor, subs, scope, tz } = loaded

        if (a.status === 'NEEDS_ACTION') {
            // An expired card waits for a new one (the pass only ran the
            // cancel checks above).
            if (a.needsActionReason === 'CARD_EXPIRED') return skip('Ждёт новую карту')
            // A stop is lifted only by a new period (a failed charge, a refused
            // grant) or by terms that fit again.
            if (a.needsActionReason !== 'TERMS_CHANGED' && a.attemptAnchorId === anchor.id) {
                return skip('Ждёт ученика')
            }
        }
        const due = autopayDueAt(anchor, tz, lastUsedAt(anchor))
        if (!due || due > now) return skip('Срок списания ещё не наступил')
        if (!inChargeWindow(now, tz)) return skip('Вне дневного окна 10:00–20:00')

        // A new period: the declines counted for the previous one don't carry.
        let failedAttempts = a.failedAttempts
        if (a.attemptAnchorId !== anchor.id) {
            const reset = await this.prisma.memberAutopay.updateMany({
                where: {
                    id: a.id,
                    status: a.status,
                    attemptAnchorId: a.attemptAnchorId,
                    failedAttempts: a.failedAttempts,
                },
                data: {
                    attemptAnchorId: anchor.id,
                    failedAttempts: 0,
                    nextAttemptAt: null,
                    lastError: null,
                    ...(a.needsActionReason === 'CHARGE_FAILED' ||
                    a.needsActionReason === 'GRANT_REFUSED'
                        ? { status: 'ACTIVE', needsActionReason: null }
                        : {}),
                },
            })
            if (reset.count !== 1) return skip('Автоплатёж изменился во время прохода')
            failedAttempts = 0
        }

        const price = await autopayRenewalPrice(this.prisma, {
            workspaceId: a.workspaceId,
            userId: a.userId,
            plan,
            now,
            today: localDateInTz(now, tz),
        })
        if (price.amount < 1) return skip('Продление выходит в 0 ₽ — оформляется в клубе')
        if (termsCheck(a, plan, price.amount) === 'changed') {
            const moved = await this.stopForTerms(loaded, price.amount)
            return moved
                ? { outcome: 'NEEDS_ACTION', reason: 'Условия тарифа изменились' }
                : skip('Ждёт подтверждения новых условий')
        }
        if (a.status === 'NEEDS_ACTION') {
            // The terms fit again (e.g. the price came back down).
            const resumed = await this.prisma.memberAutopay.updateMany({
                where: { id: a.id, status: 'NEEDS_ACTION', needsActionReason: 'TERMS_CHANGED' },
                data: { status: 'ACTIVE', needsActionReason: null },
            })
            if (resumed.count !== 1) return skip('Автоплатёж изменился во время прохода')
        }

        const start = onlineGrantStart(
            sameScopeAbonements(subs, scope),
            tz,
            now,
            vocabularyForWorkspaceType(workspace.type),
        )
        if (start.kind === 'blocked') return skip(start.message)

        const idempotenceKey = autopayIdempotenceKey(anchor.id, failedAttempts)
        // A member checkout or an earlier charge still in flight (answered or
        // not, whatever period it renews): let it settle.
        const inflight = await this.prisma.payment.findFirst({
            where: {
                workspaceId: a.workspaceId,
                userId: a.userId,
                planId: plan.id,
                status: 'PENDING',
                idempotenceKey: { not: idempotenceKey },
                OR: [
                    {
                        NOT: { idempotenceKey: { startsWith: AUTOPAY_KEY_PREFIX } },
                        createdAt: { gte: new Date(now.getTime() - PENDING_REUSE_MS) },
                    },
                    {
                        idempotenceKey: { startsWith: AUTOPAY_KEY_PREFIX },
                        providerPaymentId: { not: null },
                        createdAt: { gte: new Date(now.getTime() - AUTOPAY_INFLIGHT_MS) },
                    },
                    {
                        idempotenceKey: { startsWith: AUTOPAY_KEY_PREFIX },
                        providerPaymentId: null,
                        createdAt: { gte: new Date(now.getTime() - RESEND_BEFORE_MS) },
                    },
                ],
            },
            select: { id: true },
        })
        if (inflight) return skip('Предыдущий платёж ещё обрабатывается')
        if (!a.paymentMethodId) return skip('Нет сохранённой карты')

        const existing = await this.prisma.payment.findUnique({ where: { idempotenceKey } })
        if (existing) return this.continueCharge(loaded, existing, now)

        const request: ChargeRequest = {
            description: `Автоплатёж: абонемент «${plan.name}» — ${workspace.name}`,
            itemName: `Абонемент «${plan.name}»`,
            customerEmail: (loaded.user.email ?? a.receiptEmail).slice(0, 255),
            // No payer, no confirmation page: YooKassa never redirects.
            returnUrl: environment.appUrl ?? '',
            receipt: receiptSettingsOf(settings),
        }
        let payment: PaymentRecord
        try {
            payment = await this.prisma.payment.create({
                data: {
                    workspaceId: a.workspaceId,
                    userId: a.userId,
                    planId: plan.id,
                    planName: plan.name.slice(0, 255),
                    provider: 'YOOKASSA',
                    amount: price.amount,
                    listPrice: price.listPrice,
                    discountId: price.discountId,
                    discountName: price.discountName,
                    discountAmount: price.discountAmount,
                    currency: plan.currency,
                    idempotenceKey,
                    receiptEmail: request.customerEmail,
                    autopayId: a.id,
                    // The exact body: a re-send with this key repeats it.
                    chargeRequest: request,
                    // The pass's clock: the re-send window and the
                    // in-flight guard compare against the same `now`.
                    createdAt: now,
                },
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            return skip('Этот период уже списывается')
        }

        // The member may have cancelled while this pass was pricing: read the
        // agreement again right before the provider call (the cancel clears the
        // token in the same write). This only narrows the window — a cancel can
        // still commit while the request is at the provider; such a charge is
        // granted and staff are alerted to decide on a refund
        // (MemberAutopayAgreementsService.alertChargedAfterCancel).
        const stillLive = await this.prisma.memberAutopay.findFirst({
            where: { id: a.id, status: 'ACTIVE', paymentMethodId: a.paymentMethodId },
            select: { id: true },
        })
        if (!stillLive) {
            await this.prisma.payment.updateMany({
                where: { id: payment.id, status: 'PENDING', providerPaymentId: null },
                data: { status: 'CANCELED', failureReason: CANCELLED_BEFORE_CHARGE },
            })
            return skip('Автоплатёж отключён до списания')
        }
        return this.send(loaded, payment, request, a.paymentMethodId, now, false)
    }

    // The period's row already exists (an earlier pass, a concurrent one).
    private async continueCharge(
        loaded: Loaded,
        payment: PaymentRecord,
        now: Date,
    ): Promise<AutopayChargeResult> {
        if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
            return skip('Этот период уже списан')
        }
        if (payment.status === 'CANCELED') {
            if (payment.failureReason === CANCELLED_BEFORE_CHARGE) {
                return skip('Автоплатёж отключён до списания')
            }
            // A decline that was never counted (it arrived while the agreement
            // was stopped): count it now — guarded on the attempt — so the
            // period moves on to its next attempt instead of stalling.
            await this.agreements.onChargeDeclined(payment, payment.failureReason, now)
            return { outcome: 'DECLINED', reason: payment.failureReason }
        }
        // PENDING with the provider's id: the reconcile sweep re-reads it.
        if (payment.providerPaymentId) return skip('Платёж обрабатывается платёжной системой')
        if (payment.createdAt.getTime() > now.getTime() - RESEND_AFTER_MS) {
            return skip('Этот период уже списывается')
        }
        if (payment.createdAt.getTime() <= now.getTime() - RESEND_BEFORE_MS) {
            await this.alertLostAnswer(payment)
            return skip('Ответ платёжной системы потерян — сверьте платёж в личном кабинете ЮKassa')
        }
        const request = ChargeRequestSchema.safeParse(payment.chargeRequest)
        const methodId = loaded.agreement.paymentMethodId
        if (!request.success || !methodId) return skip('Нечем повторить запрос')
        return this.send(loaded, payment, request.data, methodId, now, true)
    }

    // The provider call. A re-send repeats the stored body with the same
    // Idempotence-Key, so YooKassa answers with the first payment if it was
    // created. Only a refusal of a first send is a decline: a re-send's 4xx
    // means the outcome of the first request is unknown.
    private async send(
        loaded: Loaded,
        payment: PaymentRecord,
        request: ChargeRequest,
        paymentMethodId: string,
        now: Date,
        resend: boolean,
    ): Promise<AutopayChargeResult> {
        const { agreement: a, settings, tz } = loaded
        const creds = toGatewayCredentials(settings, environment.encryptionKey)
        let gateway: GatewayPayment
        try {
            gateway = await this.gateway.createPayment(
                creds.provider === 'YOOKASSA' ? { ...creds, receipt: request.receipt } : creds,
                {
                    paymentId: payment.id,
                    workspaceId: a.workspaceId,
                    idempotenceKey: payment.idempotenceKey,
                    amount: payment.amount,
                    currency: payment.currency,
                    description: request.description,
                    itemName: request.itemName,
                    returnUrl: request.returnUrl,
                    customerEmail: request.customerEmail,
                    paymentMethodId,
                },
            )
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(
                `Autopay charge ${payment.id}${resend ? ' (re-send)' : ''} failed: ${err.message}${
                    err.providerMessage ? ` (${err.providerMessage})` : ''
                }`,
            )
            // No answer, an outage or a rate limit: the same request next pass.
            if (err.status === null || err.status >= 500 || err.status === 429) {
                return { outcome: 'SKIPPED', reason: 'Платёжная система не ответила — повторим', sent: true }
            }
            // The club's keys were refused: the club's problem, not the
            // member's — no decline, no member notice. A first send created
            // nothing at the provider, so its row goes (the next pass retries).
            if (err.status === 401 || err.status === 403) {
                if (!resend) {
                    await this.prisma.payment.deleteMany({
                        where: { id: payment.id, status: 'PENDING', providerPaymentId: null },
                    })
                }
                await this.notices.staffAlert({
                    workspaceId: a.workspaceId,
                    refId: `credentials:${a.workspaceId}:${localDateInTz(now, tz)}`,
                    path: 'settings',
                    message: `ЮKassa отклонила ключи магазина при автоплатеже (${err.providerMessage ?? err.status}). Автоплатежи учеников не списываются, пока подключение не исправлено в «Онлайн-оплате».`,
                    metadata: { paymentId: payment.id },
                })
                return { outcome: 'SKIPPED', reason: 'Ключи ЮKassa не приняты', sent: true }
            }
            if (resend) {
                await this.notices.staffAlert({
                    workspaceId: a.workspaceId,
                    refId: `${payment.id}:unknown`,
                    path: 'subscriptions/payments',
                    message: `Не удалось узнать, прошло ли списание автоплатежа ${payment.amount} ${payment.currency} за «${payment.planName}»: ЮKassa отклонила повтор запроса (${err.providerMessage ?? err.status}). Сверьте платёж в личном кабинете ЮKassa.`,
                    metadata: { paymentId: payment.id },
                })
                return { outcome: 'SKIPPED', reason: 'Исход списания неизвестен — сверьте в ЮKassa', sent: true }
            }
            // A first send the provider refused itself: a decline like any other.
            const reason = (err.providerMessage ?? 'refused').slice(0, 500)
            const marked = await this.prisma.payment.updateMany({
                where: { id: payment.id, status: 'PENDING' },
                data: { status: 'CANCELED', failureReason: reason },
            })
            if (marked.count === 1) {
                await this.agreements.onChargeDeclined(payment, reason, now)
            }
            return { outcome: 'DECLINED', reason, sent: true }
        }

        await this.prisma.payment.updateMany({
            where: { id: payment.id, providerPaymentId: null },
            data: { providerPaymentId: gateway.providerPaymentId },
        })
        // The same path as the webhook: whichever arrives first applies it.
        const applied = await this.activation.applyProviderStatus({
            workspaceId: a.workspaceId,
            gateway,
            now,
        })
        return { ...outcomeOf(applied, gateway), sent: true }
    }

    // Renewal charges the provider has not settled: a PENDING row with the
    // provider's id is re-read and applied (its webhook may never come); a
    // row with no answer for 20 h is reported to staff. Runs before the
    // charges, whatever the agreement's state.
    async reconcile(now: Date = new Date()): Promise<number> {
        const stale = await this.prisma.payment.findMany({
            where: {
                status: 'PENDING',
                idempotenceKey: { startsWith: AUTOPAY_KEY_PREFIX },
                createdAt: { lte: new Date(now.getTime() - RESEND_AFTER_MS) },
            },
            orderBy: { createdAt: 'asc' },
            take: MAX_CHARGES_PER_RUN,
        })
        let settled = 0
        for (const payment of stale) {
            try {
                if (!payment.providerPaymentId) {
                    if (payment.createdAt.getTime() <= now.getTime() - RESEND_BEFORE_MS) {
                        await this.alertLostAnswer(payment)
                    }
                    continue
                }
                const settings = await this.prisma.workspacePaymentSettings.findUnique({
                    where: { workspaceId: payment.workspaceId },
                })
                if (settings?.provider !== 'YOOKASSA') continue
                const gateway = await this.gateway.getPayment(
                    toGatewayCredentials(settings, environment.encryptionKey),
                    payment.providerPaymentId,
                )
                const applied = await this.activation.applyProviderStatus({
                    workspaceId: payment.workspaceId,
                    gateway,
                    now,
                })
                if (applied !== 'unchanged') settled++
                else if (payment.createdAt.getTime() <= now.getTime() - RESEND_BEFORE_MS) {
                    await this.alertLostAnswer(payment)
                }
            } catch (err) {
                this.logger.warn(
                    `Autopay reconcile of ${payment.id} failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }
        return settled
    }

    // Once per payment: the money may be taken and nothing granted.
    private async alertLostAnswer(payment: PaymentRecord) {
        this.logger.error(
            `Autopay charge ${payment.id} (key ${payment.idempotenceKey}) has had no provider answer for 20 h — reconcile it in the ЮKassa dashboard`,
        )
        await this.notices.staffAlert({
            workspaceId: payment.workspaceId,
            refId: `${payment.id}:lost`,
            path: 'subscriptions/payments',
            message: `ЮKassa так и не ответила о списании автоплатежа ${payment.amount} ${payment.currency} за «${payment.planName}». Проверьте платёж в личном кабинете ЮKassa: если деньги списаны, оформите абонемент вручную или верните их.`,
            metadata: { paymentId: payment.id },
        })
    }

    // Reminders of one ACTIVE agreement inside the window: the 3-day notice
    // (or, when the terms no longer fit, the terms-changed stop and notice)
    // and a pack's «one class left». Returns notices attempted.
    private async remindOne(id: string, now: Date): Promise<number> {
        const loaded = await this.load(id, now, { cancel: false })
        if ('result' in loaded) return 0
        const { agreement: a, plan, workspace, anchor, tz } = loaded
        if (a.status !== 'ACTIVE' || !inChargeWindow(now, tz)) return 0
        const due = autopayDueAt(anchor, tz, lastUsedAt(anchor))
        if (!due || due <= now) return 0
        const remindAt = reminderAt(anchor, tz)
        const packLow = anchor.classesTotal !== null && anchor.classesRemaining === 1
        if (!packLow && (!remindAt || remindAt > now)) return 0

        const price = await autopayRenewalPrice(this.prisma, {
            workspaceId: a.workspaceId,
            userId: a.userId,
            plan,
            now,
            today: localDateInTz(now, tz),
        })
        const check = termsCheck(a, plan, price.amount)
        if (remindAt && remindAt <= now && check === 'changed') {
            await this.stopForTerms(loaded, price.amount)
            return 1
        }
        let sent = 0
        if (remindAt && remindAt <= now) {
            await this.notices.reminder({
                autopayId: a.id,
                anchorId: anchor.id,
                userId: a.userId,
                workspaceId: a.workspaceId,
                clubName: workspace.name,
                planName: plan.name,
                amount: price.amount,
                currency: plan.currency,
                lower: check === 'lower',
                cardLast4: a.cardLast4,
                dueAt: due,
                now,
                tz,
            })
            sent++
        }
        if (packLow && check !== 'changed') {
            await this.notices.packLow({
                autopayId: a.id,
                anchorId: anchor.id,
                userId: a.userId,
                workspaceId: a.workspaceId,
                planName: plan.name,
                amount: price.amount,
                currency: plan.currency,
            })
            sent++
        }
        return sent
    }

    // ACTIVE → NEEDS_ACTION / TERMS_CHANGED with one notice per renewed
    // abonement. false: it was already stopped.
    private async stopForTerms(loaded: Loaded, amount: number): Promise<boolean> {
        const { agreement: a, plan, workspace, anchor } = loaded
        const moved = await this.prisma.memberAutopay.updateMany({
            where: { id: a.id, status: 'ACTIVE' },
            data: { status: 'NEEDS_ACTION', needsActionReason: 'TERMS_CHANGED' },
        })
        await this.notices.termsChanged({
            autopayId: a.id,
            refId: `${a.id}:${anchor.id}`,
            userId: a.userId,
            workspaceId: a.workspaceId,
            clubName: workspace.name,
            planName: plan.name,
            before: {
                amount: a.termsAmount,
                currency: a.currency,
                durationDays: a.termsDurationDays,
                classCount: a.termsClassCount,
            },
            after: {
                amount,
                currency: plan.currency,
                durationDays: plan.durationDays,
                classCount: plan.classCount,
            },
        })
        return moved.count === 1
    }

    // The agreement with everything the rules read, or the outcome when it
    // can't be charged at all: cancelled by the safety net (design §3.2 step 2,
    // 4) — unless `cancel: false` (reminders only read) — or skipped.
    private async load(
        id: string,
        now: Date,
        opts: { cancel: boolean } = { cancel: true },
    ): Promise<Loaded | { result: AutopayChargeResult }> {
        const agreement = await this.prisma.memberAutopay.findUnique({
            where: { id },
            include: agreementInclude,
        })
        if (!agreement || agreement.status === 'CANCELLED') {
            return { result: skip('Автоплатёж отключён') }
        }
        const cancel = async (reason: string) => {
            if (!opts.cancel) return { result: skip(reason) }
            await this.agreements.cancel({ id, source: 'SYSTEM', reason, now })
            return { result: { outcome: 'CANCELLED' as const, reason } }
        }
        const { plan, workspace } = agreement
        const settings = workspace.paymentSettings
        const member = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId: agreement.workspaceId, userId: agreement.userId },
            select: { id: true },
        })
        if (!member) return cancel('участник больше не в клубе')
        if (!plan || !plan.isActive || !plan.purchasableOnline || !plan.autopayAvailable) {
            return cancel('клуб больше не продлевает этот тариф автоматически')
        }
        if (!settings || !settings.autopayEnabled) return cancel('клуб отключил автоплатежи')
        if (settings.provider !== 'YOOKASSA' || settings.shopId !== agreement.shopId) {
            return cancel('клуб сменил платёжную систему')
        }
        // Skipped, not cancelled — resumes when the club does: a suspended or
        // switched-off club (its members can still list and cancel), the
        // section off, online payments not entitled.
        if (suspensionReason(workspace, environment.billing.enabled)) {
            return { result: skip('Клуб приостановлен') }
        }
        if (!workspace.subscriptionEnabled || !isWorkspaceEntitled(workspace, now)) {
            return { result: skip('Онлайн-оплата клуба сейчас недоступна') }
        }
        const subs = await loadAutopayAbonements(this.prisma, {
            workspaceMemberId: member.id,
            now,
        })
        const scope = scopeDirectionIds(plan)
        if (anchorCancelledByClub(subs, scope, now)) return cancel('абонемент отменён клубом')
        const anchor = pickAnchor(subs, scope, now)
        // Nothing of the tariff's scope current or ended within
        // RENEWAL_LAPSED_DAYS: the member left.
        if (!anchor) return cancel('давно не продлевался')
        return {
            agreement,
            plan,
            workspace,
            settings,
            user: agreement.user,
            subs,
            scope,
            anchor,
            tz: workspace.timezone,
        }
    }

    // Ids of the agreements matching `where`, page by page (by id). `visit`
    // returns false to stop.
    private async forEachCandidate(
        where: object,
        visit: (id: string) => Promise<boolean>,
    ): Promise<void> {
        let cursor: string | null = null
        for (;;) {
            const page: Array<{ id: string }> = await this.prisma.memberAutopay.findMany({
                where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
                orderBy: { id: 'asc' },
                take: PAGE,
                select: { id: true },
            })
            for (const { id } of page) {
                if (!(await visit(id))) return
            }
            if (page.length < PAGE) return
            cursor = page[page.length - 1].id
        }
    }
}

type AgreementRow = Prisma.MemberAutopayGetPayload<{ include: typeof agreementInclude }>

type Loaded = {
    agreement: AgreementRow
    plan: NonNullable<AgreementRow['plan']>
    workspace: AgreementRow['workspace']
    settings: WorkspacePaymentSettings
    user: AgreementRow['user']
    subs: AutopayAbonementRow[]
    scope: string[]
    anchor: AutopayAbonementRow
    tz: string
}
