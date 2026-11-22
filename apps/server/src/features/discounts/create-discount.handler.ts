import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { normalizePromoCode } from '../../domains/discounts/discount-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateDiscountFeature,
    type CreateDiscountFeatureResponse,
} from './create-discount.feature'
import {
    assertActiveDiscountFree,
    assertPlansInWorkspace,
    isUniqueViolation,
    loadClubToday,
} from './discount-store'
import {
    CODE_TAKEN_MESSAGE,
    discountAuditFields,
    discountDtoSelect,
    serializeDiscount,
    shapeOfInput,
} from './schemas'

// «Скидки → Новая скидка»: club money, owner and admins only.
@Feature(CreateDiscountFeature)
export class CreateDiscountHandler
    implements IFeatureHandler<CreateDiscountFeature, CreateDiscountFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CreateDiscountFeature): Promise<CreateDiscountFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const shape = shapeOfInput(f.payload)
        // The input schema already accepted the code's form.
        const code = shape.code ? normalizePromoCode(shape.code) : null
        await assertActiveDiscountFree(this.prisma, {
            workspaceId: f.workspaceId,
            exceptId: null,
            name: f.payload.name,
            isFamily: shape.isFamily,
        })
        const planIds = shape.allPlans
            ? []
            : await assertPlansInWorkspace(this.prisma, f.workspaceId, shape.planIds)

        let row
        try {
            row = await this.prisma.discount.create({
                data: {
                    workspaceId: f.workspaceId,
                    name: f.payload.name,
                    kind: shape.kind,
                    value: shape.value,
                    currency: shape.kind === 'FIXED' ? shape.currency : null,
                    code,
                    isFamily: shape.isFamily,
                    allPlans: shape.allPlans,
                    events: shape.events,
                    startsOn: shape.startsOn ? ymdToDbDate(shape.startsOn) : null,
                    endsOn: shape.endsOn ? ymdToDbDate(shape.endsOn) : null,
                    maxUses: shape.maxUses,
                    oncePerMember: shape.oncePerMember,
                    createdById: f.invokerUserId,
                    plans: { create: planIds.map((planId) => ({ planId })) },
                },
                select: discountDtoSelect,
            })
        } catch (e) {
            if (isUniqueViolation(e)) throw new BadRequestError({ message: CODE_TAKEN_MESSAGE })
            throw e
        }

        await this.audit.record({
            action: 'discount.create',
            targetType: 'discount',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: discountAuditFields(row),
        })
        this.realtime.invalidate(f.workspaceId, ['discounts'])
        const { today } = await loadClubToday(this.prisma, f.workspaceId, new Date())
        return serializeDiscount(row, { uses: 0, given: [] }, today)
    }
}
