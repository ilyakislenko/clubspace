import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDateInTz, wallClockToUtc } from '../attendance/attendance-utils'
import {
    AssignSubscriptionFeature,
    AssignSubscriptionFeatureResponse,
} from './assign-subscription.feature'
import { serializeSubscription } from './schemas'

const DAY = 24 * 60 * 60 * 1000
// How far back a coach may date a sale (a forgotten entry from the last days).
const COACH_BACKDATE_DAYS = 3

const shiftYmd = (ymd: string, days: number): string =>
    new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY)
        .toISOString()
        .slice(0, 10)

@Feature(AssignSubscriptionFeature)
export class AssignSubscriptionHandler
    implements
        IFeatureHandler<
            AssignSubscriptionFeature,
            AssignSubscriptionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
        private readonly realtime: RealtimeEmitter,
        private readonly audit: AuditService,
    ) {}

    async execute(f: AssignSubscriptionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const isAdmin = this.rbac.canWriteAllGroups(ctx)
        if (!isAdmin && f.userId === f.invokerUserId) {
            throw new ForbiddenError({
                message: 'Нельзя оформлять абонемент самому себе',
            })
        }
        await this.rbac.assertCanWriteMember(ctx, f.userId)

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { ownerId: true, timezone: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        if (f.userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'У владельца клуба доступ бессрочный, абонемент не нужен',
            })
        }

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: {
                id: true,
                subscription: {
                    select: subscriptionUsabilitySelect,
                },
            },
        })
        if (!member) throw new NotFoundError({ message: 'Участник не найден' })

        const plan = await this.prisma.plan.findFirst({
            where: { id: f.payload.planId, workspaceId: f.workspaceId },
            select: { isActive: true, price: true },
        })

        if (!isAdmin) {
            // Archived tariffs stay sellable only by an admin (a coach sees
            // them in history, not in the list).
            if (plan && !plan.isActive) {
                throw new BadRequestError({
                    message: 'Этот тариф в архиве — выберите действующий',
                })
            }
            // A coach's date is bounded: a far-future start slips past the
            // «already has a live abonement» guard and grants a long access
            // window, which is an admin-only power.
            if (f.payload.startDate) {
                const now = new Date()
                const today = localDateInTz(now, workspace.timezone)
                const current = member.subscription
                const currentEnd =
                    current?.endDate && isSubscriptionUsable(current, now)
                        ? localDateInTz(current.endDate, workspace.timezone)
                        : today
                const latest = currentEnd > today ? currentEnd : today
                if (
                    f.payload.startDate < shiftYmd(today, -COACH_BACKDATE_DAYS) ||
                    f.payload.startDate > latest
                ) {
                    throw new BadRequestError({
                        message:
                            'Тренер может оформить абонемент с сегодняшнего дня или с окончания текущего',
                    })
                }
            }
        }

        const startDate = f.payload.startDate
            ? wallClockToUtc(`${f.payload.startDate}T00:00`, workspace.timezone)
            : undefined

        const { subscription, accessUntil } =
            await this.subscriptions.grantFromPlan({
                workspaceId: f.workspaceId,
                workspaceMemberId: member.id,
                planId: f.payload.planId,
                startDate,
                amountPaid: f.payload.amountPaid,
                paid: f.payload.paid,
                source: 'MANUAL',
            })

        await this.audit.record({
            action: 'member.assignSubscription',
            targetType: 'member',
            targetId: f.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                planName: subscription.plan.name,
                amount: subscription.amountPaid,
                paid: subscription.isPaid,
                currency: subscription.currency,
                // The plan's list price next to the amount, so a coach discount shows.
                listPrice: plan?.price ?? null,
                startDate: subscription.startDate
                    ? subscription.startDate.toISOString()
                    : null,
                endDate: subscription.endDate
                    ? subscription.endDate.toISOString()
                    : null,
                accessUntil: accessUntil ? accessUntil.toISOString() : null,
            },
        })

        this.realtime.invalidate(f.workspaceId, ['members', 'subscription'])

        return {
            subscription: serializeSubscription(subscription),
            accessUntil: accessUntil ? accessUntil.toISOString() : null,
        }
    }
}
