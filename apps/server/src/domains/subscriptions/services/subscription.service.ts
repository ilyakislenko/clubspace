import { Injectable } from '@nestjs/common'

import { localDateInTz } from '../../../features/attendance/attendance-utils'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { fromFirstSession, loadClubVocabulary } from '../../../shared/utils/club-vocabulary'
import { formatRuDate } from '../../../shared/utils/format-ru-date'
import type { ClubPaymentMethodValue } from '../../../shared/utils/payment-method'
import { pluralRu } from '../../../shared/utils/plural-ru'
import {
    currentSubscriptionWhere,
    sameScope,
    scopeDirectionIds,
    scopeSnapshotCreate,
    subscriptionDtoInclude,
    subscriptionScopeIdsSelect,
} from '../current-subscriptions'
import {
    abonementWindowEnd,
    syncFirstVisitStartInTx,
} from '../first-visit-start'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../subscription-status'
import { CHANGED_MESSAGE } from '../freeze-dates'
import { UNMARK_ONLINE_MESSAGE, UNMARK_REFUNDED_MESSAGE } from '../../payments/unmark-rules'
import type { PricedSale } from '../../discounts/discount-rules'
import { priceStaffSale } from '../../discounts/discounts'
import { releaseOpenFreezesInTx } from './subscription-freeze.service'

const DAY = 24 * 60 * 60 * 1000

export type SubscriptionSourceValue = 'MANUAL' | 'GATEWAY'

export type GrantFromPlanParams = {
    workspaceId: string
    // Buyer — WorkspaceMember.id.
    workspaceMemberId: string
    planId: string
    // Omitted = "when the plan says so": the first visit for a
    // startsOnFirstVisit tariff, otherwise now. An explicit date is a dated abonement.
    startDate?: Date
    now?: Date
    // The priced amount: the agreed price on credit, what was received when
    // paid. Always passed by the caller (a staff sale prices it with
    // domains/discounts, a checkout with its Payment).
    amountPaid: number
    // The sale's price facts (docs/design/2026-11-15-discounts.md §1): the
    // tariff price before any discount (null: unknown — an import), the named
    // discount with its name snapshot and part, and who set the amount (the
    // seller; null online).
    listPrice?: number | null
    discountId?: string | null
    discountName?: string | null
    discountAmount?: number
    pricedById?: string | null
    // false = sold on credit, payment marked later via markPaid(). Default true.
    paid?: boolean
    // How staff were paid for a sale recorded as paid; ignored on credit.
    // A GATEWAY sale is always ONLINE.
    paymentMethod?: ClubPaymentMethodValue | null
    // The staff member recording a sale made as paid (the journal's
    // «Отметил»); ignored on credit and for a GATEWAY sale.
    markedPaidById?: string | null
    // MANUAL for admin-recorded abonements; GATEWAY for an online payment
    // confirmed by the provider's webhook.
    source?: SubscriptionSourceValue
    provider?: string | null
    externalPaymentId?: string | null
}

export type MarkPaidParams = {
    workspaceId: string
    userId: string
    subscriptionId: string
    amount?: number
    discountId?: string
    // Omitted = not recorded («не указано»).
    paymentMethod?: ClubPaymentMethodValue | null
    // The staff member recording it (the journal's «Отметил»).
    markedById: string
    // When the money arrived; omitted = now. «Сверить выписку» passes the
    // transfer's day (club-local midnight).
    paidAt?: Date
    now?: Date
}

// Single place that turns "member bought plan X" into a Subscription row and an
// extended access window. Both the admin flow and the payment-gateway webhook
// go through here so access is granted identically regardless of source.
@Injectable()
export class SubscriptionService {
    constructor(private readonly prisma: PrismaService) {}

    async grantFromPlan(params: GrantFromPlanParams) {
        return this.prisma.$transaction((tx) =>
            this.grantFromPlanInTx(tx, params),
        )
    }

    // The same grant inside a caller's transaction, so the payment webhook can
    // claim its Payment row and create the abonement atomically.
    async grantFromPlanInTx(
        tx: PrismaTransactionClientType,
        params: GrantFromPlanParams,
    ) {
        const plan = await tx.plan.findFirst({
            where: { id: params.planId, workspaceId: params.workspaceId },
            select: {
                id: true,
                currency: true,
                durationDays: true,
                classCount: true,
                isFreeTrial: true,
                startsOnFirstVisit: true,
                directions: { select: { directionId: true } },
            },
        })
        if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })
        const scope = scopeDirectionIds(plan)

        const now = params.now ?? new Date()
        const member = await tx.workspaceMember.findFirst({
            where: { id: params.workspaceMemberId, workspaceId: params.workspaceId },
            select: {
                id: true,
                userId: true,
                accessUntil: true,
                workspace: { select: { timezone: true } },
                subscriptions: {
                    where: currentSubscriptionWhere(now),
                    select: {
                        id: true,
                        startDate: true,
                        classesRemaining: true,
                        classesTotal: true,
                        plan: { select: { name: true } },
                        ...subscriptionScopeIdsSelect,
                        ...subscriptionUsabilitySelect,
                    },
                },
            },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        // A member may hold several abonements at once when their scopes
        // (direction sets) differ. Against a live one of the SAME scope the
        // one-live-abonement rules apply: granting on top of it used to
        // silently hide the previous pack's remaining classes. Refuse instead
        // of destroying a balance; cancelling is an explicit, visible action.
        const sameScopeCurrent = member.subscriptions.filter((s) =>
            sameScope(scopeDirectionIds(s), scope),
        )
        for (const current of sameScopeCurrent) {
            // A dated sale on the day the current abonement ends (back-to-back
            // renewal) doesn't collide with it: compare club-local days, since
            // the new start is a club midnight and the old end may be any instant.
            const endsByNewStart =
                !!params.startDate &&
                !!current.endDate &&
                localDateInTz(current.endDate, member.workspace.timezone) <=
                    localDateInTz(params.startDate, member.workspace.timezone)
            // A live class pack with classes left is never sold over, not even
            // back-to-back: the next visits of this scope would go to the
            // new pack and the paid classes of this one would expire unused.
            if (
                current.classesTotal !== null &&
                (current.classesRemaining ?? 0) > 0 &&
                isSubscriptionUsable(current, now)
            ) {
                const left = current.classesRemaining ?? 0
                throw new BadRequestError({
                    message: `В текущем абонементе осталось ${left} ${pluralRu(left, 'занятие', 'занятия', 'занятий')} — новый можно оформить, когда они закончатся, или после отмены текущего`,
                })
            }
            if (
                endsByNewStart ||
                !isSubscriptionUsable(current, params.startDate ?? now)
            ) {
                continue
            }
            const left = current.classesRemaining
            const usedUp =
                current.classesTotal != null &&
                (current.classesRemaining ?? 0) <= 0
            if (!usedUp) {
                const detail = current.startDate === null
                    ? ` («${current.plan.name}», начнётся ${fromFirstSession(await loadClubVocabulary(this.prisma, params.workspaceId))})`
                    : left != null && current.classesTotal != null
                      ? ` («${current.plan.name}», осталось ${left} из ${current.classesTotal})`
                      : ` («${current.plan.name}»)`
                throw new BadRequestError({
                    message: `У участника уже есть действующий абонемент${detail}. Снимите его, прежде чем назначать новый.`,
                })
            }
            // A pack with no classes left must not block a sale: close it.
            const closed = await tx.subscription.updateMany({
                where: { id: current.id, status: 'ACTIVE' },
                data: { status: 'EXPIRED' },
            })
            if (closed.count !== 1) {
                throw new BadRequestError({ message: CHANGED_MESSAGE })
            }
        }

        // The free trial (e.g. the first class free) is once per person in
        // the club — a trial taken before leaving and rejoining counts too.
        if (plan.isFreeTrial) {
            const used = await tx.subscription.findFirst({
                where: {
                    OR: [
                        { workspaceMemberId: member.id },
                        { workspaceId: params.workspaceId, userId: member.userId },
                    ],
                    plan: { isFreeTrial: true },
                },
                select: { id: true },
            })
            if (used) {
                throw new BadRequestError({
                    message: 'Пробное занятие уже использовано — его дают один раз',
                })
            }
        }

        const pending = !params.startDate && plan.startsOnFirstVisit
        const startDate = pending ? null : (params.startDate ?? now)
        const endDate = startDate
            ? new Date(startDate.getTime() + plan.durationDays * DAY)
            : null
        // Until the first visit the member keeps full app access up to the
        // latest possible auto-start + the term — they paid, don't lock them
        // out, and access never lapses before the abonement starts by itself.
        const windowEnd =
            endDate ??
            abonementWindowEnd(
                { endDate, createdAt: now },
                plan.durationDays,
                member.workspace.timezone,
            )

        const subscription = await tx.subscription.create({
            data: {
                workspaceId: params.workspaceId,
                planId: plan.id,
                workspaceMemberId: member.id,
                userId: member.userId,
                status: 'ACTIVE',
                startDate,
                endDate,
                startsOnFirstVisit: pending,
                durationDays: plan.durationDays,
                amountPaid: params.amountPaid,
                listPrice: params.listPrice ?? null,
                discountId: params.discountId ?? null,
                discountName: params.discountName ?? null,
                discountAmount: params.discountAmount ?? 0,
                pricedById: params.pricedById ?? null,
                currency: plan.currency,
                isPaid: params.paid ?? true,
                paidAt: (params.paid ?? true) ? now : null,
                paymentMethod:
                    params.source === 'GATEWAY'
                        ? 'ONLINE'
                        : (params.paid ?? true)
                          ? (params.paymentMethod ?? null)
                          : null,
                // Who recorded a sale made as paid; an online one has none.
                markedPaidById:
                    params.source !== 'GATEWAY' && (params.paid ?? true)
                        ? (params.markedPaidById ?? null)
                        : null,
                // Class-pack balance (null for a time-only tariff).
                classesTotal: plan.classCount,
                classesRemaining: plan.classCount,
                source: params.source ?? 'MANUAL',
                provider: params.provider ?? null,
                externalPaymentId: params.externalPaymentId ?? null,
                // Scope snapshot: a later tariff edit never changes it.
                directions: scopeSnapshotCreate(scope),
            },
            include: subscriptionDtoInclude,
        })

        // Never shorten an existing longer window (e.g. a manual grant or a
        // future-dated renewal); take the later of the two.
        const newAccessUntil =
            member.accessUntil && member.accessUntil > windowEnd
                ? member.accessUntil
                : windowEnd

        await tx.workspaceMember.update({
            where: { id: member.id },
            data: { accessUntil: newAccessUntil },
        })

        // An explicit new access window is final: an old freeze that had
        // shifted the previous window must not, when it is released later,
        // cut the days of this new abonement.
        if (member.accessUntil?.getTime() !== newAccessUntil.getTime()) {
            await tx.subscriptionFreeze.updateMany({
                where: {
                    workspaceId: params.workspaceId,
                    userId: member.userId,
                    accessShifted: true,
                },
                data: { accessShifted: false },
            })
        }

        if (!pending) return { subscription, accessUntil: newAccessUntil }

        // A visit marked on the sale day before the sale already starts it.
        await syncFirstVisitStartInTx(tx, {
            workspaceId: params.workspaceId,
            userId: member.userId,
            now,
        })
        const started = await tx.subscription.findUniqueOrThrow({
            where: { id: subscription.id },
            include: subscriptionDtoInclude,
        })
        const refreshed = await tx.workspaceMember.findUniqueOrThrow({
            where: { id: member.id },
            select: { accessUntil: true },
        })
        return { subscription: started, accessUntil: refreshed.accessUntil }
    }

    // Records that an abonement sold on credit has been paid for (an online
    // payment instead creates a paid abonement via grantFromPlanInTx).
    // `amount` is what was actually received; omitted keeps the agreed price
    // (or the discounted one). `discountId` applies a club discount now — only
    // to a sale without one that has a recorded list price; it reprices from
    // listPrice. Changing the amount or applying a discount makes the marker
    // the one who priced it (pricedById); a plain confirm keeps the seller.
    // An expired or not-yet-started abonement can still be paid — it is a debt.
    async markPaid(params: MarkPaidParams) {
        return this.prisma.$transaction((tx) => this.markPaidInTx(tx, params))
    }

    // The same mark inside a caller's transaction, so «Сверить выписку» writes
    // its transfer fingerprint and the payment atomically.
    async markPaidInTx(tx: PrismaTransactionClientType, params: MarkPaidParams) {
        const now = params.now ?? new Date()
        const sub = await tx.subscription.findFirst({
            where: {
                id: params.subscriptionId,
                workspaceId: params.workspaceId,
                workspaceMember: { userId: params.userId },
            },
            select: {
                id: true,
                status: true,
                isPaid: true,
                paidAt: true,
                amountPaid: true,
                planId: true,
                currency: true,
                listPrice: true,
                discountId: true,
                pricedById: true,
                workspace: { select: { timezone: true } },
            },
        })
        if (!sub) throw new NotFoundError({ message: 'Абонемент не найден' })
        if (sub.status === 'CANCELLED') {
            throw new BadRequestError({
                message: 'Абонемент отменён — отметить оплату нельзя',
            })
        }
        if (sub.isPaid) {
            throw new BadRequestError({
                message: sub.paidAt
                    ? `Оплата уже отмечена ${formatRuDate(sub.paidAt, sub.workspace.timezone)}`
                    : 'Оплата уже отмечена',
            })
        }

        let priced: PricedSale | null = null
        if (params.discountId) {
            if (sub.discountId) {
                throw new BadRequestError({
                    message: 'Скидку можно выбрать при оформлении абонемента',
                })
            }
            if (sub.listPrice === null) {
                throw new BadRequestError({
                    message: 'У этой продажи не записана цена тарифа',
                })
            }
            priced = await priceStaffSale(tx, {
                workspaceId: params.workspaceId,
                discountId: params.discountId,
                userId: params.userId,
                item: {
                    planId: sub.planId,
                    eventId: null,
                    listPrice: sub.listPrice,
                    currency: sub.currency,
                },
                now,
                timezone: sub.workspace.timezone,
            })
        }
        const amount = params.amount ?? priced?.amount ?? sub.amountPaid
        const repriced = priced !== null || amount !== sub.amountPaid

        // Compare-and-set: two coaches marking at once must not both succeed.
        const res = await tx.subscription.updateMany({
            where: {
                id: sub.id,
                isPaid: false,
                status: { not: 'CANCELLED' },
            },
            data: {
                isPaid: true,
                paidAt: params.paidAt ?? now,
                amountPaid: amount,
                paymentMethod: params.paymentMethod ?? null,
                markedPaidById: params.markedById,
                ...(priced
                    ? {
                          discountId: priced.discountId,
                          discountName: priced.discountName,
                          discountAmount: priced.discountAmount,
                      }
                    : {}),
                pricedById: repriced ? params.markedById : sub.pricedById,
            },
        })
        if (res.count !== 1) {
            throw new BadRequestError({ message: CHANGED_MESSAGE })
        }
        return tx.subscription.findUniqueOrThrow({
            where: { id: sub.id },
            include: subscriptionDtoInclude,
        })
    }

    // Undo of markPaid for a mistaken mark. Back to «Ожидает оплаты»: amountPaid
    // stays — it is the agreed price again while unpaid; the method and who
    // marked it go with the payment. Refused once refunded (a refund would
    // point at an unpaid sale) and for an online sale (its Payment would lose
    // its sale): those are undone with a refund in «Платежи».
    async unmarkPaid(params: {
        workspaceId: string
        userId: string
        subscriptionId: string
    }) {
        return this.prisma.$transaction(async (tx) => {
            const sub = await tx.subscription.findFirst({
                where: {
                    id: params.subscriptionId,
                    workspaceId: params.workspaceId,
                    workspaceMember: { userId: params.userId },
                },
                select: {
                    id: true,
                    status: true,
                    isPaid: true,
                    refundedAmount: true,
                    paymentMethod: true,
                    source: true,
                },
            })
            if (!sub) throw new NotFoundError({ message: 'Абонемент не найден' })
            if (sub.status === 'CANCELLED') {
                throw new BadRequestError({ message: 'Абонемент отменён' })
            }
            if (!sub.isPaid) {
                throw new BadRequestError({ message: 'Оплата не отмечена' })
            }
            if (sub.refundedAmount > 0) {
                throw new BadRequestError({ message: UNMARK_REFUNDED_MESSAGE })
            }
            if (sub.paymentMethod === 'ONLINE' || sub.source === 'GATEWAY') {
                throw new BadRequestError({ message: UNMARK_ONLINE_MESSAGE })
            }

            // Compare-and-set, same as markPaid.
            const res = await tx.subscription.updateMany({
                where: {
                    id: sub.id,
                    isPaid: true,
                    status: { not: 'CANCELLED' },
                    refundedAmount: 0,
                },
                data: { isPaid: false, paidAt: null, paymentMethod: null, markedPaidById: null },
            })
            if (res.count !== 1) {
                throw new BadRequestError({ message: CHANGED_MESSAGE })
            }
            // A statement transfer that paid it no longer did: re-uploading
            // the statement offers it again («Сверить выписку»).
            await tx.bankStatementMatch.deleteMany({ where: { subscriptionId: sub.id } })
            return tx.subscription.findUniqueOrThrow({
                where: { id: sub.id },
                include: subscriptionDtoInclude,
            })
        })
    }

    // Marks a subscription CANCELLED.
    // The access window (accessUntil) is intentionally left untouched — cancelling
    // a record shouldn't retroactively lock a member out mid-period; the owner can
    // revoke access explicitly via update-workspace-member-access. The one
    // exception: open freezes are released first and give their unused days back,
    // so access never drops below what the member had before the freeze.
    async cancel(params: { workspaceId: string; subscriptionId: string }) {
        return this.prisma.$transaction(async (tx) => {
            const sub = await tx.subscription.findFirst({
                where: { id: params.subscriptionId, workspaceId: params.workspaceId },
                select: {
                    id: true,
                    endDate: true,
                    workspace: { select: { timezone: true } },
                    workspaceMember: { select: { id: true, accessUntil: true } },
                },
            })
            if (!sub) throw new NotFoundError({ message: 'Абонемент не найден' })

            await releaseOpenFreezesInTx(tx, {
                subscription: sub,
                now: new Date(),
            })

            // Compare-and-set: two concurrent cancels (or a cancel racing a
            // freeze) must not both succeed.
            const res = await tx.subscription.updateMany({
                where: { id: sub.id, status: 'ACTIVE' },
                data: { status: 'CANCELLED' },
            })
            if (res.count !== 1) {
                throw new BadRequestError({ message: CHANGED_MESSAGE })
            }
            const updated = await tx.subscription.findUniqueOrThrow({
                where: { id: sub.id },
                include: subscriptionDtoInclude,
            })
            return updated
        })
    }
}
