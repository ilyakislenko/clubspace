// Money returned to a member (docs/design/2026-11-15-payments-journal.md §1,
// §3.2): all or part of one sale (a paid abonement or event ticket), or of an
// online payment that never became one (activationError, «unapplied»).
// CASH / TRANSFER / CARD refunds are records of money the club handed back;
// ONLINE goes through the club's provider. A refund never edits the sale's
// paid fields: it raises the sale's `refundedAmount` (a bounded increment, so
// two refunds that fit both land and an over-refund fails) and revenue
// subtracts Refund rows by refund date (domains/metrics/revenue.ts). The
// provider side keeps `Payment.refundedAmount`; online refunds of one Payment
// are serialized (an advisory lock plus the sale's lock) and one whose state
// moved since the admin's read is refused before the provider is called, so a
// double submit reaches the provider once.
import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import type { PaymentMethodValue } from '../../../shared/utils/payment-method'
import { formatMoney } from '../../analytics/money'
import { AuditService } from '../../audit/services/audit.service'
import {
    type ClubCancellation,
    EventRegistrationService,
} from '../../event-registrations/event-registration.service'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../realtime/realtime-emitter.service'
import { type StoredPaymentSettings, toGatewayCredentials } from '../payment-credentials'
import { PaymentGatewayClient } from '../payment-gateway.client'
import { PaymentGatewayError } from '../payment-gateway.types'

type Tx = PrismaTransactionClientType

export const REFUND_TARGETS = ['abonement', 'ticket', 'unapplied'] as const
export type RefundTarget = (typeof REFUND_TARGETS)[number]

export const REFUND_NOT_FOUND = 'Платёж не найден'
export const REFUND_CONFLICT = 'Возврат по этой оплате уже записан — обновите страницу'
export const REFUND_NOT_ONLINE =
    'Эту оплату принимали не онлайн — выберите, как вернули деньги'
export const REFUND_PROVIDER_OFF =
    'Платёжная система, через которую прошёл платёж, отключена — верните деньги в её личном кабинете'
export const REFUND_NEEDS_RECEIPT_EMAIL =
    'Для частичного возврата нужен e-mail для чека — верните всю сумму или наличными'
export const REFUND_UNAPPLIED_ONLINE_ONLY =
    'Оплата не зачислена — вернуть её можно только онлайн, через платёжную систему'
export const REFUND_ONLINE_FINAL = 'Онлайн-возврат отменить нельзя — деньги уже ушли'
export const REFUND_NEEDS_RECONCILIATION =
    'Деньги вернулись участнику через платёжную систему, но запись о возврате не сохранилась — сверьте её с личным кабинетом платёжной системы'
// An online refund's transaction holds its locks across the provider call:
// the gateway's own timeout (15 s per request; Stripe makes two) plus margin.
const ONLINE_REFUND_TX_TIMEOUT_MS = 45_000

// The provider's payment behind a sale, as the refund needs it.
type OnlinePayment = {
    id: string
    provider: 'YOOKASSA' | 'STRIPE'
    providerPaymentId: string | null
    status: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | 'REFUNDED'
    amount: number
    currency: string
    refundedAmount: number
    receiptEmail: string | null
    activationError: string | null
    user: { email: string | null }
}

const onlineSelect = {
    id: true,
    provider: true,
    providerPaymentId: true,
    status: true,
    amount: true,
    currency: true,
    refundedAmount: true,
    receiptEmail: true,
    activationError: true,
    user: { select: { email: true } },
} as const

// What is being refunded, source-independent.
type LoadedTarget = {
    target: RefundTarget
    id: string
    holderId: string
    itemName: string
    // What was taken and what went back so far (the sale's, or the unapplied
    // payment's own).
    paid: number
    refunded: number
    currency: string
    online: OnlinePayment | null
    // Tickets: the event, whose lock the refund's transaction takes.
    eventId: string | null
}

// The provider call an online refund makes, prepared before any lock.
type ProviderCall = {
    settings: StoredPaymentSettings
    receipt: { customerEmail: string; itemName: string } | null
}

// 2–3: the amount against what is left of the sale, the method against the
// target. Returns the online payment an ONLINE refund goes through.
const checkRefund = (
    t: LoadedTarget,
    p: { amount: number; method: PaymentMethodValue },
): OnlinePayment | null => {
    const left = t.paid - t.refunded
    if (left <= 0) {
        throw new BadRequestError({ message: 'По этой оплате всё уже возвращено' })
    }
    if (p.amount < 1 || p.amount > left) {
        throw new BadRequestError({
            message: `Вернуть можно от 1 до ${formatMoney(left, t.currency)}`,
        })
    }
    if (t.target === 'unapplied' && p.method !== 'ONLINE') {
        throw new BadRequestError({ message: REFUND_UNAPPLIED_ONLINE_ONLY })
    }
    if (p.method !== 'ONLINE') return null
    const online = t.online
    if (!online || online.status !== 'SUCCEEDED' || !online.providerPaymentId) {
        throw new BadRequestError({ message: REFUND_NOT_ONLINE })
    }
    const onlineLeft = online.amount - online.refundedAmount
    if (p.amount > onlineLeft) {
        throw new BadRequestError({
            message: `Через платёжную систему можно вернуть до ${formatMoney(onlineLeft, online.currency)}`,
        })
    }
    return online
}

export type RefundResult = {
    refundId: string
    // The refunded sale's journal key (`sub:` / `reg:`); null for unapplied.
    saleEntryId: string | null
    registrationCancelled: boolean
}

// «наличными» / «переводом» / «на карту» — how the money went back.
const METHOD_TEXT: Record<PaymentMethodValue, string> = {
    CASH: 'наличными',
    TRANSFER: 'переводом',
    CARD: 'на карту',
    ONLINE: 'на карту',
}

// The provider's idempotence key for one refund step: the same request
// retried (a double submit) is the same refund at the provider; the next
// step (refundedAmount moved) is a new one. ≤ 61 characters (YooKassa: 64).
export const refundIdempotenceKey = (
    paymentId: string,
    refundedSoFar: number,
    amount: number,
): string => `refund-${paymentId}-${refundedSoFar}-${amount}`

@Injectable()
export class RefundService {
    private readonly logger = new Logger(RefundService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly gateway: PaymentGatewayClient,
        private readonly eventRegistrations: EventRegistrationService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    // The caller has checked the club-admin tier.
    async refund(p: {
        workspaceId: string
        actorId: string
        target: RefundTarget
        targetId: string
        amount: number
        method: PaymentMethodValue
        reason: string
        now?: Date
    }): Promise<RefundResult> {
        const now = p.now ?? new Date()
        // 1–3 on what the admin saw: quick refusals before any lock.
        const seen = await this.loadTarget(this.prisma, p.workspaceId, p.target, p.targetId)
        const seenOnline = checkRefund(seen, p)
        const provider = seenOnline
            ? await this.prepareProvider(p.workspaceId, seenOnline, p.amount, seen.itemName)
            : null

        // 4–5 in one transaction, serialized per sale: a ticket under its
        // event lock (the webhook, staff marks and the member's cancel take it
        // too), an abonement under its row lock, an online refund also under an
        // advisory lock on its Payment. The target is re-read under the locks;
        // an online refund whose sale or payment moved since the admin's read
        // is refused before the provider is called (a double submit reaches the
        // provider once). The provider call sits inside the transaction, so a
        // refusal writes nothing and nothing else refunds this sale meanwhile;
        // the gateway's own timeouts bound it.
        // Set once the provider has refunded (read in the catch below).
        const attempt: { provided?: { idempotenceKey: string; online: OnlinePayment } } = {}
        let written: {
            refundId: string
            cancellation: ClubCancellation | null
            t: LoadedTarget
            online: OnlinePayment | null
        }
        try {
            written = await this.prisma.$transaction(
                async (tx) => {
                    if (seenOnline) {
                        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${seenOnline.id}))`
                    }
                    if (seen.eventId) {
                        await this.eventRegistrations.lockEventInTx(tx, seen.eventId)
                    } else if (seen.target === 'abonement') {
                        await tx.$queryRaw`SELECT 1 FROM "Subscription" WHERE "id" = ${seen.id}::uuid FOR UPDATE`
                    }
                    const t = await this.loadTarget(tx, p.workspaceId, p.target, p.targetId)
                    const online = checkRefund(t, p)
                    if (
                        online &&
                        (t.refunded !== seen.refunded ||
                            online.refundedAmount !== seenOnline?.refundedAmount)
                    ) {
                        throw new ConflictError({ message: REFUND_CONFLICT })
                    }
                    if (online && provider) {
                        const idempotenceKey = refundIdempotenceKey(online.id, online.refundedAmount, p.amount)
                        await this.refundAtProvider(provider, online, p.amount, idempotenceKey)
                        attempt.provided = { idempotenceKey, online }
                    }
                    return { ...(await this.writeRefund(tx, p, t, online, now)), t, online }
                },
                seenOnline ? { maxWait: 10_000, timeout: ONLINE_REFUND_TX_TIMEOUT_MS } : undefined,
            )
        } catch (err) {
            const done = attempt.provided
            if (!done) throw err
            // The provider returned the money but nothing was recorded (the
            // transaction failed after its answer): the record must be
            // reconciled by hand against the provider's dashboard.
            this.logger.error(
                `Refund NOT recorded after the provider refunded it: payment ${done.online.id}, provider payment ${done.online.providerPaymentId}, amount ${p.amount} ${done.online.currency}, idempotence key ${done.idempotenceKey}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
            throw new ConflictError({ message: REFUND_NEEDS_RECONCILIATION })
        }
        const { refundId, cancellation, t, online } = written

        // 6. Audit.
        await this.audit.record({
            action: 'payment.refund',
            targetType: 'member',
            targetId: t.holderId,
            workspaceId: p.workspaceId,
            actorId: p.actorId,
            metadata: {
                refundId,
                target: t.target,
                targetId: t.id,
                itemName: t.itemName,
                amount: p.amount,
                currency: t.currency,
                method: p.method,
                reason: p.reason,
                ...(online ? { paymentId: online.id, provider: online.provider } : {}),
                ...(cancellation ? { registrationCancelled: true } : {}),
            },
        })

        // 7. The holder hears about it; 8. screens refetch.
        await this.notifyHolder(p, t, refundId, cancellation !== null)
        this.realtime.invalidate(p.workspaceId, realtimeResources(t.target))
        if (cancellation) await this.eventRegistrations.afterClubCancel(cancellation)

        return {
            refundId,
            saleEntryId:
                t.target === 'abonement' ? `sub:${t.id}` : t.target === 'ticket' ? `reg:${t.id}` : null,
            registrationCancelled: cancellation !== null,
        }
    }

    // A mistaken offline refund record goes; the sale's refundedAmount drops
    // back (its money counts as revenue again). A registration a full refund
    // cancelled stays cancelled: its place may have gone to the waitlist.
    async deleteRecord(p: {
        workspaceId: string
        actorId: string
        refundId: string
    }): Promise<void> {
        const refund = await this.prisma.refund.findFirst({
            where: { id: p.refundId, workspaceId: p.workspaceId },
        })
        if (!refund) throw new NotFoundError({ message: 'Возврат не найден' })
        if (refund.method === 'ONLINE') {
            throw new BadRequestError({ message: REFUND_ONLINE_FINAL })
        }
        await this.prisma.$transaction(async (tx) => {
            const gone = await tx.refund.deleteMany({ where: { id: refund.id } })
            if (gone.count === 0) throw new ConflictError({ message: REFUND_CONFLICT })
            const restored = refund.subscriptionId
                ? await tx.subscription.updateMany({
                      where: { id: refund.subscriptionId, refundedAmount: { gte: refund.amount } },
                      data: { refundedAmount: { decrement: refund.amount } },
                  })
                : refund.eventRegistrationId
                  ? await tx.eventRegistration.updateMany({
                        where: {
                            id: refund.eventRegistrationId,
                            refundedAmount: { gte: refund.amount },
                        },
                        data: { refundedAmount: { decrement: refund.amount } },
                    })
                  : { count: 1 }
            if (restored.count === 0) throw new ConflictError({ message: REFUND_CONFLICT })
        })
        await this.audit.record({
            action: 'payment.refundDelete',
            targetType: 'member',
            targetId: refund.userId,
            workspaceId: p.workspaceId,
            actorId: p.actorId,
            metadata: {
                refundId: refund.id,
                target: refund.subscriptionId ? 'abonement' : 'ticket',
                targetId: refund.subscriptionId ?? refund.eventRegistrationId,
                itemName: refund.itemName,
                amount: refund.amount,
                currency: refund.currency,
                method: refund.method,
                reason: refund.reason,
                refundedAt: refund.refundedAt.toISOString(),
                createdById: refund.createdById,
            },
        })
        this.realtime.invalidate(
            p.workspaceId,
            realtimeResources(refund.subscriptionId ? 'abonement' : 'ticket'),
        )
    }

    // 1. The target in this club. An abonement or ticket must be paid
    // (a cancelled abonement may be refunded); an unapplied payment must have
    // succeeded without granting anything. `db`: the client, or the refund's
    // transaction for the re-read under its locks.
    private async loadTarget(
        db: Tx,
        workspaceId: string,
        target: RefundTarget,
        id: string,
    ): Promise<LoadedTarget> {
        if (target === 'abonement') {
            const s = await db.subscription.findFirst({
                where: { id, workspaceId, isPaid: true },
                select: {
                    id: true,
                    amountPaid: true,
                    refundedAmount: true,
                    currency: true,
                    userId: true,
                    workspaceMember: { select: { userId: true } },
                    plan: { select: { name: true } },
                    payment: { select: onlineSelect },
                },
            })
            if (!s) throw new NotFoundError({ message: REFUND_NOT_FOUND })
            const holderId = s.userId ?? s.workspaceMember?.userId ?? null
            if (!holderId) {
                // A legacy row sold before the holder was stored, whose member
                // has left: nobody to record the refund for.
                throw new BadRequestError({
                    message: 'У этой оплаты не указан ученик — возврат записать нельзя',
                })
            }
            return {
                target,
                id: s.id,
                holderId,
                itemName: s.plan.name,
                paid: s.amountPaid,
                refunded: s.refundedAmount,
                currency: s.currency,
                online: s.payment,
                eventId: null,
            }
        }
        if (target === 'ticket') {
            const r = await db.eventRegistration.findFirst({
                where: { id, workspaceId, isPaid: true },
                select: {
                    id: true,
                    amountPaid: true,
                    refundedAmount: true,
                    currency: true,
                    paymentMethod: true,
                    userId: true,
                    eventId: true,
                    event: { select: { title: true, currency: true } },
                    // The payment that marked it paid online (any other that
                    // succeeded carries an activationError).
                    payments: {
                        where: { status: 'SUCCEEDED', activationError: null },
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: onlineSelect,
                    },
                },
            })
            if (!r) throw new NotFoundError({ message: REFUND_NOT_FOUND })
            return {
                target,
                id: r.id,
                holderId: r.userId,
                itemName: r.event.title,
                paid: r.amountPaid ?? 0,
                refunded: r.refundedAmount,
                currency: r.currency ?? r.event.currency,
                online: r.paymentMethod === 'ONLINE' ? (r.payments[0] ?? null) : null,
                eventId: r.eventId,
            }
        }
        const payment = await db.payment.findFirst({
            where: { id, workspaceId },
            select: { ...onlineSelect, userId: true, planName: true },
        })
        if (!payment) throw new NotFoundError({ message: REFUND_NOT_FOUND })
        if (payment.status === 'REFUNDED') {
            throw new BadRequestError({ message: 'Деньги по этому платежу уже возвращены' })
        }
        if (payment.status !== 'SUCCEEDED' || payment.activationError === null) {
            throw new NotFoundError({ message: REFUND_NOT_FOUND })
        }
        return {
            target,
            id: payment.id,
            holderId: payment.userId,
            itemName: payment.planName,
            paid: payment.amount,
            refunded: payment.refundedAmount,
            currency: payment.currency,
            online: payment,
            eventId: null,
        }
    }

    // The provider side of an online refund, checked before any lock: the
    // payment's provider still connected, and — YooKassa with receipts on, a
    // partial refund — the 54-ФЗ receipt's e-mail (the payment's receipt
    // e-mail, else the payer's current one).
    private async prepareProvider(
        workspaceId: string,
        online: OnlinePayment,
        amount: number,
        itemName: string,
    ): Promise<ProviderCall> {
        const settings = await this.prisma.workspacePaymentSettings.findUnique({
            where: { workspaceId },
        })
        if (!settings || settings.provider !== online.provider) {
            throw new BadRequestError({ message: REFUND_PROVIDER_OFF })
        }
        if (settings.provider === 'YOOKASSA' && settings.receiptEnabled && amount < online.amount) {
            const email = online.receiptEmail ?? online.user.email
            if (!email) throw new BadRequestError({ message: REFUND_NEEDS_RECEIPT_EMAIL })
            return { settings, receipt: { customerEmail: email, itemName } }
        }
        return { settings, receipt: null }
    }

    // 4. The provider refunds `amount`; a refusal is a 400 and rolls the
    // refund's transaction back.
    private async refundAtProvider(
        call: ProviderCall,
        online: OnlinePayment,
        amount: number,
        idempotenceKey: string,
    ): Promise<void> {
        try {
            await this.gateway.refund(toGatewayCredentials(call.settings, environment.encryptionKey), {
                paymentId: online.id,
                providerPaymentId: online.providerPaymentId!,
                amount,
                currency: online.currency,
                idempotenceKey,
                ...(call.receipt ? { receipt: call.receipt } : {}),
            })
        } catch (err) {
            if (!(err instanceof PaymentGatewayError)) throw err
            this.logger.warn(`Refund of payment ${online.id} failed: ${err.message}`)
            throw new BadRequestError({
                message: `Платёжная система не провела возврат${
                    err.providerMessage ? `: ${err.providerMessage}` : ''
                }`,
            })
        }
    }

    // 5. The sale's bounded increment, the provider payment's CAS, the Refund
    // row and — for a ticket refunded in full before its event — the place
    // given up. Any refusal rolls everything back (409).
    private async writeRefund(
        tx: Tx,
        p: { workspaceId: string; actorId: string; amount: number; method: PaymentMethodValue; reason: string },
        t: LoadedTarget,
        online: OnlinePayment | null,
        now: Date,
    ): Promise<{ refundId: string; cancellation: ClubCancellation | null }> {
        const bound = { refundedAmount: { lte: t.paid - p.amount } }
        const increment = { refundedAmount: { increment: p.amount } }
        if (t.target === 'abonement') {
            const res = await tx.subscription.updateMany({
                where: { id: t.id, isPaid: true, ...bound },
                data: increment,
            })
            if (res.count === 0) throw new ConflictError({ message: REFUND_CONFLICT })
        } else if (t.target === 'ticket') {
            const res = await tx.eventRegistration.updateMany({
                where: { id: t.id, isPaid: true, ...bound },
                data: increment,
            })
            if (res.count === 0) throw new ConflictError({ message: REFUND_CONFLICT })
        }
        if (online) {
            const refundedAmount = online.refundedAmount + p.amount
            const res = await tx.payment.updateMany({
                where: { id: online.id, status: 'SUCCEEDED', refundedAmount: online.refundedAmount },
                data: {
                    refundedAmount,
                    status: refundedAmount >= online.amount ? 'REFUNDED' : 'SUCCEEDED',
                    refundedAt: now,
                },
            })
            if (res.count === 0) throw new ConflictError({ message: REFUND_CONFLICT })
        }
        const refund = await tx.refund.create({
            data: {
                workspaceId: p.workspaceId,
                subscriptionId: t.target === 'abonement' ? t.id : null,
                eventRegistrationId: t.target === 'ticket' ? t.id : null,
                paymentId: online?.id ?? null,
                userId: t.holderId,
                itemName: t.itemName.slice(0, 255),
                amount: p.amount,
                currency: t.currency,
                method: p.method,
                reason: p.reason,
                createdById: p.actorId,
                refundedAt: now,
            },
            select: { id: true },
        })
        let cancellation: ClubCancellation | null = null
        if (t.target === 'ticket') {
            // Read after the increment: concurrent refunds that completed the
            // sale count too.
            const after = await tx.eventRegistration.findUniqueOrThrow({
                where: { id: t.id },
                select: { refundedAmount: true, amountPaid: true },
            })
            if (after.refundedAmount >= (after.amountPaid ?? 0)) {
                cancellation = await this.eventRegistrations.cancelByClubInTx(tx, {
                    registrationId: t.id,
                    now,
                })
            }
        }
        return { refundId: refund.id, cancellation }
    }

    // Best-effort, deduped on the refund: the money is recorded, a failed push
    // must not undo it. An abonement's push opens «Мой абонемент», a ticket's
    // the events screen (`eventRegistrationId`).
    private async notifyHolder(
        p: { workspaceId: string; amount: number; method: PaymentMethodValue },
        t: LoadedTarget,
        refundId: string,
        registrationCancelled: boolean,
    ): Promise<void> {
        try {
            const workspace = await this.prisma.workspace.findUnique({
                where: { id: p.workspaceId },
                select: { name: true },
            })
            const club = workspace?.name ?? 'Клуб'
            const money = formatMoney(p.amount, t.currency)
            const how = METHOD_TEXT[p.method]
            await this.notifications.notifyUser({
                userId: t.holderId,
                kind: 'payment.refunded',
                refId: refundId,
                topic: 'Возврат денег',
                message: registrationCancelled
                    ? `Клуб «${club}» отменил вашу запись на «${t.itemName}» и вернул ${money} — ${how}`
                    : `Клуб «${club}» вернул ${money} за «${t.itemName}» — ${how}`,
                metadata: {
                    refundId,
                    amount: p.amount,
                    currency: t.currency,
                    ...(t.target === 'abonement' ? { subscriptionId: t.id } : {}),
                    ...(t.target === 'ticket'
                        ? { eventRegistrationId: t.id, eventId: t.eventId }
                        : {}),
                    ...(t.target === 'unapplied' ? { paymentId: t.id } : {}),
                },
                workspaceId: p.workspaceId,
            })
        } catch (err) {
            this.logger.warn(
                `Refund notification failed: ${err instanceof Error ? err.message : String(err)}`,
            )
        }
    }
}

// 8. What refetches: the journal always; the member card for an abonement;
// event screens and «Записавшиеся» for a ticket.
const realtimeResources = (target: RefundTarget): string[] =>
    target === 'abonement'
        ? ['payments', 'members', 'subscription']
        : target === 'ticket'
          ? ['payments', 'events', 'eventregistrations']
          : ['payments']
