import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { NotFoundError } from '../../../shared/errors/shared.errors'

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
                select: { id: true, price: true, currency: true, durationDays: true },
            })
            if (!plan) throw new NotFoundError({ message: 'Plan not found' })

            const member = await tx.workspaceMember.findFirst({
                where: { id: params.workspaceMemberId, workspaceId: params.workspaceId },
                select: { id: true, accessUntil: true },
            })
            if (!member) throw new NotFoundError({ message: 'Member not found' })

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
                    source: params.source ?? 'MANUAL',
                    provider: params.provider ?? null,
                    externalPaymentId: params.externalPaymentId ?? null,
                },
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
            if (!sub) throw new NotFoundError({ message: 'Subscription not found' })

            const updated = await tx.subscription.update({
                where: { id: sub.id },
                data: { status: 'CANCELLED' },
            })
            await tx.workspaceMember.updateMany({
                where: { workspaceId: params.workspaceId, subscriptionId: sub.id },
                data: { subscriptionId: null },
            })
            return updated
        })
    }
}
