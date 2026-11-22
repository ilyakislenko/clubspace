import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { localDateInTz } from '../../features/attendance/attendance-utils'
import {
    type MemberAutopay,
    PrismaService,
    type PrismaTransactionClientType,
} from '../../infrastructure/prisma'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'
import { formatMoney } from '../analytics/money'
import { AuditService } from '../audit/services/audit.service'
import { declineReasonRu } from '../payments/decline-reasons'
import type { GatewayPayment } from '../payments/payment-gateway.types'
import { RealtimeEmitter } from '../realtime/realtime-emitter.service'
import {
    currentSubscriptionWhere,
    sameScope,
    scopeDirectionIds,
} from '../subscriptions/current-subscriptions'
import { AutopayNotificationsService } from './autopay-notifications'
import { autopayRenewalPrice } from './autopay-offer'
import {
    type AutopayCancelSource,
    autopayLiveKey,
    autopayRetryAt,
    MAX_AUTOPAY_ATTEMPTS,
    termsCheck,
} from './autopay-rules'

type Tx = PrismaTransactionClientType

// The Payment fields the agreement bookkeeping reads.
export type AutopayPaymentRef = {
    id: string
    workspaceId: string
    userId: string
    planId: string | null
    planName: string
    amount: number
    currency: string
    idempotenceKey: string
    autopayId: string | null
    autopayConsentVersion: string | null
    receiptEmail: string | null
    createdAt: Date
    autopayRenewalAmount: number | null
    autopayShopId: string | null
}

// A setup payment's agreement, for the activation's audit and push.
export type AutopaySetup = {
    autopayId: string
    // Older same-scope agreements this one replaced (cancelled in the same
    // transaction); announced after commit.
    replaced: CancelledAgreement[]
    termsAmount: number
    currency: string
    cardLast4: string | null
}

type CancelledAgreement = {
    id: string
    workspaceId: string
    userId: string
    planId: string | null
    planName: string
    source: AutopayCancelSource
    actorId: string | null
    reason: string | null
}

// What a renewal charge's Idempotence-Key says: the renewed abonement and the
// attempt (`autopay:<anchorId>:<attempt>`, autopayIdempotenceKey).
const parseChargeKey = (key: string): { anchorId: string; attempt: number } | null => {
    const m = /^autopay:([0-9a-f-]{36}):(\d+)$/.exec(key)
    return m ? { anchorId: m[1], attempt: Number(m[2]) } : null
}

// Writes to member autopay agreements outside the hourly pass: the setup by a
// paid checkout and the outcome of each renewal charge (both called by
// PaymentActivationService, so the webhook and the direct answer apply them
// once), cancellations from any source, and the terms-change notice of a
// tariff edit. Every cancellation wipes the saved token in the same write
// (376-ФЗ: a refused card is never used again), is audited and confirmed to
// the member in writing.
@Injectable()
export class MemberAutopayAgreementsService {
    private readonly logger = new Logger(MemberAutopayAgreementsService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly notices: AutopayNotificationsService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    // ─── Setup (inside the activation's claim transaction) ──────────────

    // The member ticked autopay and paid; YooKassa saved the card. Replaces a
    // live same-scope agreement on another tariff, re-arms this tariff's live
    // one (NEEDS_ACTION: paying with a new card) or creates it. The terms are
    // the renewal price (automatic discounts only) and what the abonement
    // granted. null: nothing saved (the abonement stands, no agreement).
    async setUpFromPaymentInTx(
        tx: Tx,
        payment: AutopayPaymentRef,
        gateway: GatewayPayment,
        sub: { durationDays: number | null; classesTotal: number | null },
        now: Date,
    ): Promise<AutopaySetup | null> {
        const method = gateway.paymentMethod
        if (!method?.saved || !payment.planId || !payment.autopayConsentVersion) {
            return null
        }
        const [settings, plan, workspace] = await Promise.all([
            tx.workspacePaymentSettings.findUnique({
                where: { workspaceId: payment.workspaceId },
                select: { provider: true, shopId: true, autopayEnabled: true },
            }),
            tx.plan.findUnique({
                where: { id: payment.planId },
                select: {
                    id: true,
                    name: true,
                    price: true,
                    currency: true,
                    durationDays: true,
                    autopayAvailable: true,
                    directions: { select: { directionId: true } },
                },
            }),
            tx.workspace.findUniqueOrThrow({
                where: { id: payment.workspaceId },
                select: { timezone: true },
            }),
        ])
        // Autopay must still be allowed exactly as at the checkout: the global
        // switch, the club setting, the tariff, and the very shop the card was
        // saved in. Otherwise the abonement stands and the token is not kept.
        if (
            !environment.memberAutopay.enabled ||
            settings?.provider !== 'YOOKASSA' ||
            !settings.autopayEnabled ||
            !settings.shopId ||
            settings.shopId !== payment.autopayShopId ||
            !plan?.autopayAvailable
        ) {
            return null
        }

        // The amount the consent showed («дальше Y»): a price that rose since
        // is caught at charge time as TERMS_CHANGED, never taken silently.
        const termsAmount =
            payment.autopayRenewalAmount ??
            (
                await autopayRenewalPrice(tx, {
                    workspaceId: payment.workspaceId,
                    userId: payment.userId,
                    plan,
                    now,
                    today: localDateInTz(now, workspace.timezone),
                })
            ).amount

        const scope = scopeDirectionIds(plan)
        const others = await tx.memberAutopay.findMany({
            where: {
                workspaceId: payment.workspaceId,
                userId: payment.userId,
                status: { not: 'CANCELLED' },
                planId: { not: plan.id },
            },
            select: { id: true, plan: { select: { directions: { select: { directionId: true } } } } },
        })
        const replaced: CancelledAgreement[] = []
        for (const other of others) {
            if (!other.plan || !sameScope(scopeDirectionIds(other.plan), scope)) continue
            const cancelled = await this.cancelInTx(tx, {
                id: other.id,
                source: 'SYSTEM',
                actorId: null,
                reason: 'заменён новым автоплатежом',
                now,
            })
            if (cancelled) replaced.push(cancelled)
        }

        const cardLast4 = method.cardLast4?.slice(-4) ?? null
        const terms = {
            planName: plan.name.slice(0, 255),
            status: 'ACTIVE' as const,
            needsActionReason: null,
            paymentMethodId: method.id.slice(0, 64),
            paymentMethodTitle: method.title?.slice(0, 64) ?? null,
            cardLast4,
            shopId: settings.shopId,
            receiptEmail: (payment.receiptEmail ?? '').slice(0, 255),
            termsAmount,
            currency: plan.currency,
            termsDurationDays: sub.durationDays ?? plan.durationDays,
            termsClassCount: sub.classesTotal,
            consentVersion: payment.autopayConsentVersion,
            consentedAt: payment.createdAt,
            failedAttempts: 0,
            attemptAnchorId: null,
            nextAttemptAt: null,
            lastError: null,
        }
        const liveKey = autopayLiveKey(payment.userId, plan.id)
        const existing = await tx.memberAutopay.findUnique({
            where: { liveKey },
            select: { id: true },
        })
        // Re-arm only a live row (a cancel committed meanwhile stays final —
        // a new token is never written onto a refused agreement); otherwise
        // a fresh agreement.
        const rearmed = existing
            ? await tx.memberAutopay.updateMany({
                  where: { id: existing.id, status: { not: 'CANCELLED' } },
                  data: terms,
              })
            : { count: 0 }
        const autopayId =
            existing && rearmed.count === 1
                ? existing.id
                : (
                      await tx.memberAutopay.create({
                          data: {
                              ...terms,
                              workspaceId: payment.workspaceId,
                              userId: payment.userId,
                              planId: plan.id,
                              liveKey,
                              provider: 'YOOKASSA',
                          },
                          select: { id: true },
                      })
                  ).id
        await tx.payment.update({
            where: { id: payment.id },
            data: { autopayId },
        })
        return {
            autopayId,
            replaced,
            termsAmount: terms.termsAmount,
            currency: terms.currency,
            cardLast4,
        }
    }

    // After the setup committed: the audit entry and the notices of the
    // agreements it replaced.
    async announceSetUp(payment: AutopayPaymentRef, setup: AutopaySetup) {
        await this.audit.record({
            action: 'autopay.enabled',
            targetType: 'member',
            targetId: payment.userId,
            workspaceId: payment.workspaceId,
            actorId: payment.userId,
            metadata: {
                autopayId: setup.autopayId,
                paymentId: payment.id,
                planName: payment.planName,
                termsAmount: setup.termsAmount,
                currency: setup.currency,
                cardLast4: setup.cardLast4,
                consentVersion: payment.autopayConsentVersion,
            },
        })
        await this.announceCancelled(setup.replaced)
    }

    // ─── Renewal outcomes ───────────────────────────────────────────────

    // A renewal charge succeeded and granted the abonement (inside the claim
    // transaction): a fresh start, a lower price becomes the agreed one. The
    // write is guarded, so a cancel that committed meanwhile stays final —
    // 'cancelled' tells the activation the money arrived after a refusal.
    async onChargeSucceededInTx(
        tx: Tx,
        payment: Pick<AutopayPaymentRef, 'autopayId' | 'amount'>,
        now: Date,
    ): Promise<'reset' | 'cancelled' | 'none'> {
        if (!payment.autopayId) return 'none'
        const row = await tx.memberAutopay.findUnique({
            where: { id: payment.autopayId },
            select: { status: true, termsAmount: true },
        })
        if (!row) return 'none'
        if (row.status === 'CANCELLED') return 'cancelled'
        const reset = await tx.memberAutopay.updateMany({
            where: { id: payment.autopayId, status: { not: 'CANCELLED' } },
            data: {
                status: 'ACTIVE',
                needsActionReason: null,
                failedAttempts: 0,
                attemptAnchorId: null,
                nextAttemptAt: null,
                lastError: null,
                lastChargedAt: now,
                termsAmount: Math.min(row.termsAmount, payment.amount),
            },
        })
        return reset.count === 1 ? 'reset' : 'cancelled'
    }

    // A renewal charge was already at the provider when the member cancelled
    // and it went through: the abonement is granted; staff decide on a
    // refund (E1 «Платежи»).
    async alertChargedAfterCancel(payment: AutopayPaymentRef) {
        const user = await this.prisma.user.findUnique({
            where: { id: payment.userId },
            select: { firstname: true, lastname: true },
        })
        await this.notices.staffAlert({
            workspaceId: payment.workspaceId,
            refId: `${payment.id}:after-cancel`,
            path: 'subscriptions/payments',
            message: `Автоплатёж ${fullNameWithoutEmail(user ?? { firstname: null, lastname: null })} за «${payment.planName}» (${formatMoney(payment.amount, payment.currency)}) прошёл после того, как ученик его отключил: списание уже было отправлено. Абонемент оформлен — решите, вернуть ли деньги, в «Платежах».`,
            metadata: { autopayId: payment.autopayId, paymentId: payment.id },
        })
    }

    // A renewal charge was declined (the payment is already CANCELED): count
    // it, then retry, stop or cancel by the reason (design §1 «Retries»). The
    // member hears every time; staff on the first decline and on a stop.
    async onChargeDeclined(
        payment: AutopayPaymentRef,
        reason: string | null,
        now: Date,
    ): Promise<void> {
        if (!payment.autopayId) return
        const key = parseChargeKey(payment.idempotenceKey)
        const row = await this.prisma.memberAutopay.findUnique({
            where: { id: payment.autopayId },
            include: {
                workspace: { select: { timezone: true } },
                user: { select: { firstname: true, lastname: true } },
            },
        })
        if (!row || row.status !== 'ACTIVE') return
        const attempt = key?.attempt ?? row.failedAttempts
        const failed = attempt + 1
        const tz = row.workspace.timezone
        const reasonText = declineReasonRu(reason)
        const stop =
            reason === 'card_expired'
                ? ('CARD_EXPIRED' as const)
                : failed >= MAX_AUTOPAY_ATTEMPTS
                  ? ('CHARGE_FAILED' as const)
                  : null
        const nextAttemptAt =
            stop || reason === 'permission_revoked' ? null : autopayRetryAt(now, tz, failed)

        // CAS on the attempt the charge was made with: a decline is counted once.
        const counted = await this.prisma.memberAutopay.updateMany({
            where: { id: row.id, status: 'ACTIVE', failedAttempts: attempt },
            data: {
                failedAttempts: failed,
                attemptAnchorId: key?.anchorId ?? row.attemptAnchorId,
                lastError: reasonText.slice(0, 500),
                nextAttemptAt,
                ...(stop ? { status: 'NEEDS_ACTION', needsActionReason: stop } : {}),
            },
        })
        if (counted.count !== 1) return

        await this.audit.record({
            action: 'autopay.chargeFailed',
            targetType: 'member',
            targetId: row.userId,
            workspaceId: row.workspaceId,
            actorId: null,
            metadata: {
                autopayId: row.id,
                paymentId: payment.id,
                planName: row.planName,
                amount: payment.amount,
                currency: payment.currency,
                reason,
                attempt: failed,
                nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
                ...(stop ? { needsActionReason: stop } : {}),
            },
        })
        this.realtime.invalidate(row.workspaceId, ['subscription', 'payments'])

        const member = fullNameWithoutEmail(row.user)
        if (reason === 'permission_revoked') {
            await this.cancel({
                id: row.id,
                source: 'SYSTEM',
                reason: reasonText,
                now,
            })
            await this.notices.staffAlert({
                workspaceId: row.workspaceId,
                refId: `${payment.id}:revoked`,
                path: 'retention?tab=renew',
                message: `Автоплатёж ${member} по тарифу «${row.planName}» отключён: ${reasonText}.`,
                metadata: { autopayId: row.id, paymentId: payment.id },
            })
            return
        }
        await this.notices.chargeFailed({
            autopayId: row.id,
            paymentId: payment.id,
            userId: row.userId,
            workspaceId: row.workspaceId,
            planName: row.planName,
            amount: payment.amount,
            currency: payment.currency,
            reasonText,
            nextAttemptAt,
            tz,
        })
        if (stop) {
            await this.notices.staffAlert({
                workspaceId: row.workspaceId,
                refId: `${payment.id}:stopped`,
                path: 'retention?tab=renew',
                message: `Автоплатёж ${member} по тарифу «${row.planName}» остановлен: ${reasonText}. Ученик может оплатить в приложении.`,
                metadata: { autopayId: row.id, paymentId: payment.id },
            })
        } else if (failed === 1) {
            await this.notices.staffAlert({
                workspaceId: row.workspaceId,
                refId: `${payment.id}:declined`,
                path: 'retention?tab=renew',
                message: `Не прошло списание ${formatMoney(payment.amount, payment.currency)} автоплатежом у ${member} за «${row.planName}»: ${reasonText}.${
                    nextAttemptAt ? ' Повторим автоматически.' : ''
                }`,
                metadata: { autopayId: row.id, paymentId: payment.id },
            })
        }
    }

    // A renewal charge was paid but its abonement could not be granted (e.g.
    // staff sold a same-scope pack seconds earlier): the agreement stops and
    // staff refund or grant by hand (E1's unapplied flow).
    async onGrantRefused(payment: AutopayPaymentRef, reason: string): Promise<void> {
        if (!payment.autopayId) return
        const key = parseChargeKey(payment.idempotenceKey)
        const stopped = await this.prisma.memberAutopay.updateMany({
            where: { id: payment.autopayId, status: 'ACTIVE' },
            data: {
                status: 'NEEDS_ACTION',
                needsActionReason: 'GRANT_REFUSED',
                attemptAnchorId: key?.anchorId ?? undefined,
                nextAttemptAt: null,
                lastError: reason.slice(0, 500),
            },
        })
        if (stopped.count !== 1) return
        this.realtime.invalidate(payment.workspaceId, ['subscription', 'payments'])
        const user = await this.prisma.user.findUnique({
            where: { id: payment.userId },
            select: { firstname: true, lastname: true },
        })
        await this.notices.staffAlert({
            workspaceId: payment.workspaceId,
            refId: `${payment.id}:grant-refused`,
            path: 'subscriptions/payments',
            message: `Списали ${formatMoney(payment.amount, payment.currency)} автоплатежом у ${fullNameWithoutEmail(user ?? { firstname: null, lastname: null })}, но абонемент не оформлен: ${reason}. Верните деньги в «Платежах» или оформите абонемент вручную.`,
            metadata: { autopayId: payment.autopayId, paymentId: payment.id },
        })
    }

    // ─── Cancellation ───────────────────────────────────────────────────

    // Stops future charges at once and wipes the token in the same write.
    // Idempotent: an already cancelled agreement is returned unchanged. The
    // current, already paid abonement is untouched.
    async cancel(p: {
        id: string
        source: AutopayCancelSource
        actorId?: string | null
        reason?: string | null
        now?: Date
    }): Promise<MemberAutopay | null> {
        const cancelled = await this.cancelInTx(this.prisma, {
            id: p.id,
            source: p.source,
            actorId: p.actorId ?? null,
            reason: p.reason ?? null,
            now: p.now ?? new Date(),
        })
        if (cancelled) await this.announceCancelled([cancelled])
        return this.prisma.memberAutopay.findUnique({ where: { id: p.id } })
    }

    // Membership ended or the account is being deleted (workspaceId null:
    // every club).
    async cancelForUser(
        workspaceId: string | null,
        userId: string,
        reason: string,
    ): Promise<number> {
        return this.cancelWhere({ userId, ...(workspaceId ? { workspaceId } : {}) }, reason)
    }

    // The tariff was retired, deleted, or lost online sale / autopay.
    async cancelForPlan(planId: string, reason: string): Promise<number> {
        return this.cancelWhere({ planId }, reason)
    }

    // The club turned autopay off, changed provider or shop, or disconnected.
    async cancelForWorkspace(workspaceId: string, reason: string): Promise<number> {
        return this.cancelWhere({ workspaceId }, reason)
    }

    // A tariff edit made a renewal dearer or changed its term / pack size: an
    // immediate notice to each live agreement whose terms it now exceeds. The
    // status stays until charge time (the pass moves it to NEEDS_ACTION).
    async notifyTermsChanged(planId: string): Promise<number> {
        const plan = await this.prisma.plan.findUnique({
            where: { id: planId },
            select: {
                id: true,
                name: true,
                price: true,
                currency: true,
                durationDays: true,
                classCount: true,
                updatedAt: true,
                workspace: { select: { name: true, timezone: true } },
            },
        })
        if (!plan?.workspace) return 0
        const rows = await this.prisma.memberAutopay.findMany({
            where: { planId, status: { not: 'CANCELLED' } },
        })
        const now = new Date()
        const today = localDateInTz(now, plan.workspace.timezone)
        let sent = 0
        for (const row of rows) {
            const renewal = await autopayRenewalPrice(this.prisma, {
                workspaceId: row.workspaceId,
                userId: row.userId,
                plan,
                now,
                today,
            })
            if (termsCheck(row, plan, renewal.amount) !== 'changed') continue
            await this.notices.termsChanged({
                autopayId: row.id,
                refId: `${row.id}:plan:${plan.updatedAt.getTime()}`,
                userId: row.userId,
                workspaceId: row.workspaceId,
                clubName: plan.workspace.name,
                planName: plan.name,
                before: {
                    amount: row.termsAmount,
                    currency: row.currency,
                    durationDays: row.termsDurationDays,
                    classCount: row.termsClassCount,
                },
                after: {
                    amount: renewal.amount,
                    currency: plan.currency,
                    durationDays: plan.durationDays,
                    classCount: plan.classCount,
                },
            })
            sent++
        }
        return sent
    }

    private async cancelWhere(
        where: { userId?: string; workspaceId?: string; planId?: string },
        reason: string,
    ): Promise<number> {
        const live = await this.prisma.memberAutopay.findMany({
            where: { ...where, status: { not: 'CANCELLED' } },
            select: { id: true },
        })
        let count = 0
        for (const { id } of live) {
            const cancelled = await this.cancelInTx(this.prisma, {
                id,
                source: 'SYSTEM',
                actorId: null,
                reason,
                now: new Date(),
            })
            if (!cancelled) continue
            count++
            await this.announceCancelled([cancelled])
        }
        return count
    }

    // The compare-and-set: only a live agreement turns CANCELLED, with the
    // token and the live key cleared in the same write.
    private async cancelInTx(
        db: Pick<Tx, 'memberAutopay'>,
        p: {
            id: string
            source: AutopayCancelSource
            actorId: string | null
            reason: string | null
            now: Date
        },
    ): Promise<CancelledAgreement | null> {
        const res = await db.memberAutopay.updateMany({
            where: { id: p.id, status: { not: 'CANCELLED' } },
            data: {
                status: 'CANCELLED',
                liveKey: null,
                paymentMethodId: null,
                // Nothing personal stays on a refused agreement (the last 4
                // digits remain for the history line).
                paymentMethodTitle: null,
                receiptEmail: '',
                needsActionReason: null,
                nextAttemptAt: null,
                cancelledAt: p.now,
                cancelSource: p.source,
                cancelledById: p.source === 'STAFF' ? p.actorId : null,
                cancelReason: p.reason?.slice(0, 200) ?? null,
            },
        })
        if (res.count !== 1) return null
        const row = await db.memberAutopay.findUniqueOrThrow({
            where: { id: p.id },
            select: { workspaceId: true, userId: true, planId: true, planName: true },
        })
        return { id: p.id, ...row, source: p.source, actorId: p.actorId, reason: p.reason }
    }

    // After commit: the audit entry and the member's written confirmation
    // («…до {date}» names the current abonement of the tariff's scope).
    private async announceCancelled(list: readonly CancelledAgreement[]) {
        for (const c of list) {
            await this.audit.record({
                action: 'autopay.cancelled',
                targetType: 'member',
                targetId: c.userId,
                workspaceId: c.workspaceId,
                actorId:
                    c.source === 'MEMBER' ? c.userId : c.source === 'STAFF' ? c.actorId : null,
                metadata: {
                    autopayId: c.id,
                    planName: c.planName,
                    source: c.source,
                    reason: c.reason,
                },
            })
            this.realtime.invalidate(c.workspaceId, ['subscription', 'payments'])
            try {
                const { tz, accessUntil } = await this.currentEnd(c)
                await this.notices.cancelled({
                    autopayId: c.id,
                    userId: c.userId,
                    workspaceId: c.workspaceId,
                    planName: c.planName,
                    reason: c.source === 'MEMBER' ? null : c.reason,
                    accessUntil,
                    tz,
                })
            } catch (err) {
                this.logger.warn(
                    `Cancel notice for autopay ${c.id} failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }
    }

    // The latest end among the member's current abonements of the tariff's
    // scope (any scope when the tariff is gone).
    private async currentEnd(c: CancelledAgreement) {
        const [workspace, plan, subs] = await Promise.all([
            this.prisma.workspace.findUniqueOrThrow({
                where: { id: c.workspaceId },
                select: { timezone: true },
            }),
            c.planId
                ? this.prisma.plan.findUnique({
                      where: { id: c.planId },
                      select: { directions: { select: { directionId: true } } },
                  })
                : null,
            this.prisma.subscription.findMany({
                where: {
                    ...currentSubscriptionWhere(),
                    workspaceId: c.workspaceId,
                    userId: c.userId,
                },
                select: { endDate: true, directions: { select: { directionId: true } } },
            }),
        ])
        const scope = plan ? scopeDirectionIds(plan) : null
        const ends = subs
            .filter((s) => scope === null || sameScope(scopeDirectionIds(s), scope))
            .map((s) => s.endDate)
            .filter((d): d is Date => d !== null)
            .sort((a, b) => b.getTime() - a.getTime())
        return { tz: workspace.timezone, accessUntil: ends[0] ?? null }
    }
}
