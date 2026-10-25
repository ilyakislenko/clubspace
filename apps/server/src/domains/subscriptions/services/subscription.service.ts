import { Injectable } from '@nestjs/common'

import { localDateInTz } from '../../../features/attendance/attendance-utils'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { formatRuDate } from '../../../shared/utils/format-ru-date'
import {
    abonementWindowEnd,
    syncFirstVisitStartInTx,
} from '../first-visit-start'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../subscription-status'
import {
    CHANGED_MESSAGE,
    releaseOpenFreezesInTx,
} from './subscription-freeze.service'

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
    // Defaults to the plan price when omitted (e.g. a comped abonement passes 0).
    amountPaid?: number | null
    // false = sold on credit, payment marked later via markPaid(). Default true.
    paid?: boolean
    // MANUAL for admin-recorded abonements; GATEWAY reserved for a future
    // payment-provider webhook that will reuse this exact method.
    source?: SubscriptionSourceValue
    provider?: string | null
    externalPaymentId?: string | null
}

// Single place that turns "member bought plan X" into a Subscription row and an
// extended access window. Both the admin flow and any future payment-gateway
// webhook go through here so access is granted identically regardless of source.
@Injectable()
export class SubscriptionService {
    constructor(private readonly prisma: PrismaService) {}

    async grantFromPlan(params: GrantFromPlanParams) {
        return this.prisma.$transaction(async (tx) => {
            const plan = await tx.plan.findFirst({
                where: { id: params.planId, workspaceId: params.workspaceId },
                select: {
                    id: true,
                    price: true,
                    currency: true,
                    durationDays: true,
                    classCount: true,
                    isFreeTrial: true,
                    startsOnFirstVisit: true,
                },
            })
            if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })

            const member = await tx.workspaceMember.findFirst({
                where: { id: params.workspaceMemberId, workspaceId: params.workspaceId },
                select: {
                    id: true,
                    userId: true,
                    accessUntil: true,
                    workspace: { select: { timezone: true } },
                    subscription: {
                        select: {
                            id: true,
                            startDate: true,
                            classesRemaining: true,
                            classesTotal: true,
                            plan: { select: { name: true } },
                            ...subscriptionUsabilitySelect,
                        },
                    },
                },
            })
            if (!member) throw new NotFoundError({ message: 'Участник не найден' })

            // Granting on top of a live abonement used to just create a second
            // row and repoint the member at it — the previous pack's remaining
            // classes became invisible and unusable while still sitting in the
            // table as ACTIVE (and still counted by revenue reports). Refuse
            // instead of silently destroying a balance; cancelling the current
            // one is an explicit, visible action.
            const now = params.now ?? new Date()
            const current = member.subscription
            // A dated sale on the day the current abonement ends (back-to-back
            // renewal) doesn't collide with it: compare club-local days, since
            // the new start is a club midnight and the old end may be any instant.
            const endsByNewStart =
                !!params.startDate &&
                !!current?.endDate &&
                localDateInTz(current.endDate, member.workspace.timezone) <=
                    localDateInTz(params.startDate, member.workspace.timezone)
            if (
                current &&
                !endsByNewStart &&
                isSubscriptionUsable(current, params.startDate ?? now)
            ) {
                const left = current.classesRemaining
                const usedUp =
                    current.classesTotal != null &&
                    (current.classesRemaining ?? 0) <= 0
                if (!usedUp) {
                    const detail = current.startDate === null
                        ? ` («${current.plan.name}», начнётся с первой тренировки)`
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

            // The free trial (e.g. the first class free) is once per member.
            if (plan.isFreeTrial) {
                const used = await tx.subscription.findFirst({
                    where: {
                        workspaceMemberId: member.id,
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
                    status: 'ACTIVE',
                    startDate,
                    endDate,
                    startsOnFirstVisit: pending,
                    durationDays: plan.durationDays,
                    amountPaid: params.amountPaid ?? plan.price,
                    currency: plan.currency,
                    isPaid: params.paid ?? true,
                    paidAt: (params.paid ?? true) ? now : null,
                    // Class-pack balance (null for a time-only tariff).
                    classesTotal: plan.classCount,
                    classesRemaining: plan.classCount,
                    source: params.source ?? 'MANUAL',
                    provider: params.provider ?? null,
                    externalPaymentId: params.externalPaymentId ?? null,
                },
                include: { plan: { select: { id: true, name: true } } },
            })

            // Never shorten an existing longer window (e.g. a manual grant or a
            // future-dated renewal); take the later of the two.
            const newAccessUntil =
                member.accessUntil && member.accessUntil > windowEnd
                    ? member.accessUntil
                    : windowEnd

            await tx.workspaceMember.update({
                where: { id: member.id },
                data: { subscriptionId: subscription.id, accessUntil: newAccessUntil },
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
                include: { plan: { select: { id: true, name: true } } },
            })
            const refreshed = await tx.workspaceMember.findUniqueOrThrow({
                where: { id: member.id },
                select: { accessUntil: true },
            })
            return { subscription: started, accessUntil: refreshed.accessUntil }
        })
    }

    // Records that an abonement has been paid for. Lives here (not in the
    // handler) because a payment-gateway webhook will call the same method.
    // `amount` is what was actually received; omitted keeps the agreed price.
    // An expired or not-yet-started abonement can still be paid — it is a debt.
    async markPaid(params: {
        workspaceId: string
        userId: string
        subscriptionId: string
        amount?: number
        now?: Date
    }) {
        return this.prisma.$transaction(async (tx) => {
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

            // Compare-and-set: two coaches marking at once must not both succeed.
            const res = await tx.subscription.updateMany({
                where: {
                    id: sub.id,
                    isPaid: false,
                    status: { not: 'CANCELLED' },
                },
                data: {
                    isPaid: true,
                    paidAt: now,
                    amountPaid: params.amount ?? sub.amountPaid,
                },
            })
            if (res.count !== 1) {
                throw new BadRequestError({ message: CHANGED_MESSAGE })
            }
            return tx.subscription.findUniqueOrThrow({
                where: { id: sub.id },
                include: { plan: { select: { id: true, name: true } } },
            })
        })
    }

    // Marks a subscription CANCELLED and drops it as anyone's "current" pointer.
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
                include: { plan: { select: { id: true, name: true } } },
            })
            await tx.workspaceMember.updateMany({
                where: { workspaceId: params.workspaceId, subscriptionId: sub.id },
                data: { subscriptionId: null },
            })
            return updated
        })
    }
}
