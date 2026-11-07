import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    GetMyStudyPlanFeature,
    GetMyStudyPlanFeatureResponse,
} from './get-my-study-plan.feature'
import { loadOwnPlan, loadPlanDetail } from './schemas'

@Feature(GetMyStudyPlanFeature)
export class GetMyStudyPlanHandler
    implements IFeatureHandler<GetMyStudyPlanFeature, GetMyStudyPlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(f: GetMyStudyPlanFeature): Promise<GetMyStudyPlanFeatureResponse> {
        const plan = await loadOwnPlan(this.prisma, f)
        return await loadPlanDetail(this.prisma, this.courseAccess, plan)
    }
}
