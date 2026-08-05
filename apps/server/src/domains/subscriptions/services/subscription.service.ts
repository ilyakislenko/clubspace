import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../subscription-status'

const DAY = 24 * 60 * 60 * 1000

export type SubscriptionSourceValue = 'MANUAL' | 'GATEWAY'

export type GrantFromPlanParams = {
    workspaceId: string
    // Buyer — WorkspaceMember.id.
    workspaceMemberId: string
    planId: string
    startDate: Date
    // Defaults to the plan price when omitted (e.g. a comped abonement passes 0).
    amountPaid?: number | null
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
                },
            })
            if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })

            const member = await tx.workspaceMember.findFirst({
                where: { id: params.workspaceMemberId, workspaceId: params.workspaceId },
                select: {
                    id: true,
                    accessUntil: true,
                    subscription: {
                        select: {
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
            const current = member.subscription
            if (isSubscriptionUsable(current, params.startDate)) {
                const left = current?.classesRemaining
                const detail =
                    left != null && current?.classesTotal != null
                        ? ` («${current.plan.name}», осталось ${left} из ${current.classesTotal})`
                        : ` («${current?.plan.name}»)`
                throw new BadRequestError({
                    message: `У участника уже есть действующий абонемент${detail}. Снимите его, прежде чем назначать новый.`,
                })
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

            const endDate = new Date(
                params.startDate.getTime() + plan.durationDays * DAY,
            )

            const subscription = await tx.subscription.create({
                data: {
                    workspaceId: params.workspaceId,
                    planId: plan.id,
                    workspaceMemberId: member.id,
                    status: 'ACTIVE',
                    startDate: params.startDate,
                    endDate,
                    amountPaid: params.amountPaid ?? plan.price,
                    currency: plan.currency,
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
                member.accessUntil && member.accessUntil > endDate
                    ? member.accessUntil
                    : endDate

            await tx.workspaceMember.update({
                where: { id: member.id },
                data: { subscriptionId: subscription.id, accessUntil: newAccessUntil },
            })

            return { subscription, accessUntil: newAccessUntil }
        })
    }

    // Marks a subscription CANCELLED and drops it as anyone's "current" pointer.
    // The access window (accessUntil) is intentionally left untouched — cancelling
    // a record shouldn't retroactively lock a member out mid-period; the owner can
    // revoke access explicitly via update-workspace-member-access.
    async cancel(params: { workspaceId: string; subscriptionId: string }) {
        return this.prisma.$transaction(async (tx) => {
            const sub = await tx.subscription.findFirst({
                where: { id: params.subscriptionId, workspaceId: params.workspaceId },
                select: { id: true },
            })
            if (!sub) throw new NotFoundError({ message: 'Абонемент не найден' })

            const updated = await tx.subscription.update({
                where: { id: sub.id },
                data: { status: 'CANCELLED' },
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
