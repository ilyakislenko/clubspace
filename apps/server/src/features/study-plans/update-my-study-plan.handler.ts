import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import { loadOwnPlan, loadPlanDetail } from './schemas'
import {
    UpdateMyStudyPlanFeature,
    UpdateMyStudyPlanFeatureResponse,
} from './update-my-study-plan.feature'

@Feature(UpdateMyStudyPlanFeature)
export class UpdateMyStudyPlanHandler
    implements
        IFeatureHandler<UpdateMyStudyPlanFeature, UpdateMyStudyPlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(f: UpdateMyStudyPlanFeature): Promise<UpdateMyStudyPlanFeatureResponse> {
        const plan = await loadOwnPlan(this.prisma, f)
        const { title, description } = f.payload
        const updated = await this.prisma.studyPlan.update({
            where: { id: plan.id },
            data: {
                ...(title !== undefined && { title }),
                ...(description !== undefined && { description: description || null }),
            },
        })
        return await loadPlanDetail(this.prisma, this.courseAccess, updated)
    }
}
