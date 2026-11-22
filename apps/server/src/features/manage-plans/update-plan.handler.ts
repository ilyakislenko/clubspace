import { Feature, IFeatureHandler } from '@shelfjs/features'

import { MemberAutopayAgreementsService } from '../../domains/autopay/member-autopay-agreements.service'
import {
    sameScope,
    scopeDirectionIds,
} from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { claimUnchanged } from '../../shared/utils/optimistic-concurrency'
import {
    assertClubOffersAutopay,
    assertDirectionsInWorkspace,
    AUTOPAY_MIN_DURATION_DAYS,
    AUTOPAY_NEEDS_ONLINE_MESSAGE,
    AUTOPAY_SHORT_TERM_MESSAGE,
    canSellOnline,
    ONLINE_FREE_PLAN_MESSAGE,
    PLAN_AUTOPAY_OFF_REASON,
    PLAN_SCOPE_CHANGED_REASON,
    PLAN_WRITE_REFUSAL,
    planDtoInclude,
    serializePlan,
} from './schemas'
import {
    UpdatePlanFeature,
    UpdatePlanFeatureResponse,
} from './update-plan.feature'

@Feature(UpdatePlanFeature)
export class UpdatePlanHandler
    implements IFeatureHandler<UpdatePlanFeature, UpdatePlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly autopay: MemberAutopayAgreementsService,
    ) {}

    async execute(f: UpdatePlanFeature) {
        await assertClubAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            PLAN_WRITE_REFUSAL,
        )
        const existing = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            select: {
                id: true,
                price: true,
                isFreeTrial: true,
                isActive: true,
                purchasableOnline: true,
                autopayAvailable: true,
                durationDays: true,
                classCount: true,
                directions: { select: { directionId: true } },
            },
        })
        if (!existing) throw new NotFoundError({ message: 'Тариф не найден' })

        const p = f.payload
        if (
            (p.purchasableOnline ?? existing.purchasableOnline) &&
            !canSellOnline({
                price: p.price ?? existing.price,
                isFreeTrial: p.isFreeTrial ?? existing.isFreeTrial,
            })
        ) {
            throw new BadRequestError({ message: ONLINE_FREE_PLAN_MESSAGE })
        }
        // Autopay renews an online sale; a form re-sending a ticked box is
        // fine even after the club turned autopay off — only ticking it is
        // checked against the club setting.
        const purchasableOnline = p.purchasableOnline ?? existing.purchasableOnline
        if (p.autopayAvailable) {
            if (!purchasableOnline) {
                throw new BadRequestError({ message: AUTOPAY_NEEDS_ONLINE_MESSAGE })
            }
            if (!existing.autopayAvailable) {
                await assertClubOffersAutopay(this.prisma, f.workspaceId)
            }
        }
        const autopayAvailable =
            purchasableOnline && (p.autopayAvailable ?? existing.autopayAvailable)
        if (autopayAvailable && (p.durationDays ?? existing.durationDays) < AUTOPAY_MIN_DURATION_DAYS) {
            throw new BadRequestError({ message: AUTOPAY_SHORT_TERM_MESSAGE })
        }
        const directionIds =
            p.directionIds !== undefined
                ? await assertDirectionsInWorkspace(
                      this.prisma,
                      f.workspaceId,
                      p.directionIds,
                  )
                : undefined
        // A new scope replaces the old set in the same write; abonements
        // already sold keep their snapshot. A stale form is refused first, in
        // the same transaction.
        const plan = await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(p.expectedUpdatedAt, (expected) =>
                tx.plan.updateMany({
                    where: { id: f.planId, workspaceId: f.workspaceId, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            return tx.plan.update({
                where: { id: f.planId },
                data: {
                    ...(p.name !== undefined ? { name: p.name } : {}),
                    ...(p.description !== undefined
                        ? { description: p.description ?? null }
                        : {}),
                    ...(p.price !== undefined ? { price: p.price } : {}),
                    ...(p.currency !== undefined
                        ? { currency: p.currency.toUpperCase() }
                        : {}),
                    ...(p.durationDays !== undefined
                        ? { durationDays: p.durationDays }
                        : {}),
                    ...(p.classCount !== undefined
                        ? { classCount: p.classCount }
                        : {}),
                    ...(p.isFreeTrial !== undefined
                        ? { isFreeTrial: p.isFreeTrial }
                        : {}),
                    ...(p.startsOnFirstVisit !== undefined
                        ? { startsOnFirstVisit: p.startsOnFirstVisit }
                        : {}),
                    ...(p.isActive !== undefined
                        ? { isActive: p.isActive }
                        : {}),
                    ...(p.purchasableOnline !== undefined
                        ? { purchasableOnline: p.purchasableOnline }
                        : {}),
                    ...(autopayAvailable !== existing.autopayAvailable
                        ? { autopayAvailable }
                        : {}),
                    ...(directionIds !== undefined
                        ? {
                              directions: {
                                  deleteMany: {},
                                  create: directionIds.map((directionId) => ({
                                      directionId,
                                  })),
                              },
                          }
                        : {}),
                },
                include: planDtoInclude,
            })
        })

        // Live agreements (docs/design/2026-11-15-member-autopay.md §3.5):
        // the tariff stopped renewing by autopay → cancel them; its scope
        // changed → cancel them too (they renew abonements of the old scope;
        // the member re-arms with a new purchase); less favourable terms →
        // tell the members now (the charge waits for their confirmation, the
        // service compares per agreement).
        const renews = (x: { isActive: boolean; purchasableOnline: boolean; autopayAvailable: boolean }) =>
            x.isActive && x.purchasableOnline && x.autopayAvailable
        const scopeChanged = !sameScope(
            scopeDirectionIds(existing),
            plan.directions.map((d) => d.direction.id),
        )
        if (renews(existing) && !renews(plan)) {
            await this.autopay.cancelForPlan(plan.id, PLAN_AUTOPAY_OFF_REASON)
        } else if (renews(existing) && scopeChanged) {
            await this.autopay.cancelForPlan(plan.id, PLAN_SCOPE_CHANGED_REASON)
        } else if (
            renews(plan) &&
            (plan.price > existing.price ||
                plan.durationDays !== existing.durationDays ||
                plan.classCount !== existing.classCount)
        ) {
            await this.autopay.notifyTermsChanged(plan.id)
        }
        return serializePlan(plan)
    }
}
