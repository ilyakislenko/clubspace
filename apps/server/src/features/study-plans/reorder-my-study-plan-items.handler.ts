import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    ReorderMyStudyPlanItemsFeature,
    ReorderMyStudyPlanItemsFeatureResponse,
} from './reorder-my-study-plan-items.feature'
import { loadOwnPlan, loadPlanDetail, touchPlan } from './schemas'
import { isSameItemSet } from './study-plans-utils'

@Feature(ReorderMyStudyPlanItemsFeature)
export class ReorderMyStudyPlanItemsHandler
    implements
        IFeatureHandler<
            ReorderMyStudyPlanItemsFeature,
            ReorderMyStudyPlanItemsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(
        f: ReorderMyStudyPlanItemsFeature,
    ): Promise<ReorderMyStudyPlanItemsFeatureResponse> {
        const plan = await loadOwnPlan(this.prisma, f)
        const current = await this.prisma.studyPlanItem.findMany({
            where: { planId: plan.id },
            select: { id: true },
        })
        const { itemIds } = f.payload
        if (!isSameItemSet(current.map((i) => i.id), itemIds)) {
            throw new BadRequestError({
                message: 'План изменился — обновите его и попробуйте снова',
            })
        }
        await this.prisma.$transaction(
            itemIds.map((id, position) =>
                this.prisma.studyPlanItem.update({ where: { id }, data: { position } }),
            ),
        )
        const touched = await touchPlan(this.prisma, plan.id)
        return await loadPlanDetail(this.prisma, this.courseAccess, touched)
    }
}
