import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreatePlanFeature,
    CreatePlanFeatureResponse,
} from './create-plan.feature'
import {
    assertDirectionsInWorkspace,
    canSellOnline,
    ONLINE_FREE_PLAN_MESSAGE,
    PLAN_WRITE_REFUSAL,
    planDtoInclude,
    serializePlan,
} from './schemas'

@Feature(CreatePlanFeature)
export class CreatePlanHandler
    implements IFeatureHandler<CreatePlanFeature, CreatePlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreatePlanFeature) {
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
        if (
            f.payload.purchasableOnline &&
            !canSellOnline({
                price: f.payload.price,
                isFreeTrial: f.payload.isFreeTrial ?? false,
            })
        ) {
            throw new BadRequestError({ message: ONLINE_FREE_PLAN_MESSAGE })
        }
        const directionIds = await assertDirectionsInWorkspace(
            this.prisma,
            f.workspaceId,
            f.payload.directionIds ?? [],
        )
        // The nested create of the scope runs in the same write.
        const plan = await this.prisma.plan.create({
            data: {
                workspaceId: f.workspaceId,
                name: f.payload.name,
                description: f.payload.description ?? null,
                price: f.payload.price,
                currency: f.payload.currency.toUpperCase(),
                durationDays: f.payload.durationDays,
                classCount: f.payload.classCount ?? null,
                isFreeTrial: f.payload.isFreeTrial ?? false,
                startsOnFirstVisit: f.payload.startsOnFirstVisit ?? false,
                isActive: f.payload.isActive ?? true,
                purchasableOnline: f.payload.purchasableOnline ?? false,
                directions: {
                    create: directionIds.map((directionId) => ({ directionId })),
                },
            },
            include: planDtoInclude,
        })
        return serializePlan(plan)
    }
}
