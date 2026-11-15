import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { normalizePromoCode } from '../../domains/discounts/discount-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { dbDateToYmd, ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { claimUnchanged } from '../../shared/utils/optimistic-concurrency'
import {
    assertActiveDiscountFree,
    assertPlansInWorkspace,
    isUniqueViolation,
    loadClubToday,
    loadDiscountStats,
} from './discount-store'
import {
    CODE_TAKEN_MESSAGE,
    discountAuditFields,
    discountDtoSelect,
    type DiscountShape,
    discountShapeIssue,
    serializeDiscount,
} from './schemas'
import {
    UpdateDiscountFeature,
    type UpdateDiscountFeatureResponse,
} from './update-discount.feature'

// Edit / archive / restore a discount: club money, owner and admins only.
// Past sales keep their snapshot (name, part); only future sales see the edit.
@Feature(UpdateDiscountFeature)
export class UpdateDiscountHandler
    implements IFeatureHandler<UpdateDiscountFeature, UpdateDiscountFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UpdateDiscountFeature): Promise<UpdateDiscountFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.discount.findFirst({
            where: { id: f.discountId, workspaceId: f.workspaceId },
            select: discountDtoSelect,
        })
        if (!existing) throw new NotFoundError({ message: 'Скидка не найдена' })

        const p = f.payload
        const kind = p.kind ?? existing.kind
        const merged: DiscountShape = {
            kind,
            value: p.value ?? existing.value,
            // Switching to a percent drops the currency.
            currency:
                p.currency !== undefined
                    ? p.currency
                        ? p.currency.toUpperCase()
                        : null
                    : kind === 'PERCENT'
                      ? null
                      : existing.currency,
            code: p.code !== undefined ? p.code || null : existing.code,
            isFamily: p.isFamily ?? existing.isFamily,
            allPlans: p.allPlans ?? existing.allPlans,
            planIds: p.planIds ?? existing.plans.map((x) => x.planId),
            events: p.events ?? existing.events,
            startsOn:
                p.startsOn !== undefined
                    ? p.startsOn
                    : existing.startsOn
                      ? dbDateToYmd(existing.startsOn)
                      : null,
            endsOn:
                p.endsOn !== undefined
                    ? p.endsOn
                    : existing.endsOn
                      ? dbDateToYmd(existing.endsOn)
                      : null,
            maxUses: p.maxUses !== undefined ? p.maxUses : existing.maxUses,
            oncePerMember: p.oncePerMember ?? existing.oncePerMember,
        }
        const issue = discountShapeIssue(merged)
        if (issue) throw new BadRequestError({ message: issue })
        const code = merged.code ? normalizePromoCode(merged.code) : null

        const isActive = p.isActive ?? existing.isActive
        const restoring = isActive && !existing.isActive
        const name = p.name ?? existing.name
        if (isActive) {
            await assertActiveDiscountFree(this.prisma, {
                workspaceId: f.workspaceId,
                exceptId: existing.id,
                name: restoring || name.toLowerCase() !== existing.name.toLowerCase() ? name : null,
                isFamily: merged.isFamily && (restoring || !existing.isFamily),
            })
        }
        const planIds =
            !merged.allPlans && p.planIds !== undefined
                ? await assertPlansInWorkspace(this.prisma, f.workspaceId, p.planIds)
                : undefined

        let row
        try {
            row = await this.prisma.$transaction(async (tx) => {
                await claimUnchanged(p.expectedUpdatedAt, (expected) =>
                    tx.discount.updateMany({
                        where: { id: existing.id, workspaceId: f.workspaceId, updatedAt: expected },
                        data: { updatedAt: new Date() },
                    }),
                )
                return tx.discount.update({
                    where: { id: existing.id },
                    data: {
                        name,
                        kind: merged.kind,
                        value: merged.value,
                        currency: merged.kind === 'FIXED' ? merged.currency : null,
                        code,
                        isFamily: merged.isFamily,
                        allPlans: merged.allPlans,
                        events: merged.events,
                        startsOn: merged.startsOn ? ymdToDbDate(merged.startsOn) : null,
                        endsOn: merged.endsOn ? ymdToDbDate(merged.endsOn) : null,
                        maxUses: merged.maxUses,
                        oncePerMember: merged.oncePerMember,
                        isActive,
                        ...(merged.allPlans
                            ? { plans: { deleteMany: {} } }
                            : planIds !== undefined
                              ? {
                                    plans: {
                                        deleteMany: {},
                                        create: planIds.map((planId) => ({ planId })),
                                    },
                                }
                              : {}),
                    },
                    select: discountDtoSelect,
                })
            })
        } catch (e) {
            if (isUniqueViolation(e)) throw new BadRequestError({ message: CODE_TAKEN_MESSAGE })
            throw e
        }

        const before = discountAuditFields(existing)
        const after = discountAuditFields(row)
        const changes = Object.fromEntries(
            (Object.keys(after) as Array<keyof typeof after>)
                .filter((k) => k !== 'isActive')
                .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
                .map((k) => [k, { from: before[k], to: after[k] }]),
        )
        await this.audit.record({
            action:
                isActive === existing.isActive
                    ? 'discount.update'
                    : isActive
                      ? 'discount.restore'
                      : 'discount.archive',
            targetType: 'discount',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata:
                isActive === existing.isActive
                    ? { name: row.name, changes }
                    : { ...after, ...(Object.keys(changes).length > 0 ? { changes } : {}) },
        })
        this.realtime.invalidate(f.workspaceId, ['discounts'])

        const now = new Date()
        const [{ today }, stats] = await Promise.all([
            loadClubToday(this.prisma, f.workspaceId, now),
            loadDiscountStats(this.prisma, [row.id]),
        ])
        return serializeDiscount(row, stats.get(row.id) ?? { uses: 0, given: [] }, today)
    }
}
