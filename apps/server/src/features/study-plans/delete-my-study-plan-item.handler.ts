import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    DeleteMyStudyPlanItemFeature,
    DeleteMyStudyPlanItemFeatureResponse,
} from './delete-my-study-plan-item.feature'
import { loadOwnPlan, loadPlanDetail, touchPlan } from './schemas'

@Feature(DeleteMyStudyPlanItemFeature)
export class DeleteMyStudyPlanItemHandler
    implements
        IFeatureHandler<
            DeleteMyStudyPlanItemFeature,
            DeleteMyStudyPlanItemFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(
        f: DeleteMyStudyPlanItemFeature,
    ): Promise<DeleteMyStudyPlanItemFeatureResponse> {
        const plan = await loadOwnPlan(this.prisma, f)
        const { count } = await this.prisma.studyPlanItem.deleteMany({
            where: { id: f.itemId, planId: plan.id },
        })
        if (count === 0) {
            throw new NotFoundError({ message: 'Фрагмент плана не найден' })
        }
        const touched = await touchPlan(this.prisma, plan.id)
        return await loadPlanDetail(this.prisma, this.courseAccess, touched)
    }
}
