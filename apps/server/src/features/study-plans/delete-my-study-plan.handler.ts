import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    DeleteMyStudyPlanFeature,
    DeleteMyStudyPlanFeatureResponse,
} from './delete-my-study-plan.feature'
import { loadOwnPlan } from './schemas'

@Feature(DeleteMyStudyPlanFeature)
export class DeleteMyStudyPlanHandler
    implements
        IFeatureHandler<DeleteMyStudyPlanFeature, DeleteMyStudyPlanFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: DeleteMyStudyPlanFeature): Promise<DeleteMyStudyPlanFeatureResponse> {
        const plan = await loadOwnPlan(this.prisma, f)
        // Items go with it (FK cascade).
        await this.prisma.studyPlan.delete({ where: { id: plan.id } })
        return { status: 'deleted' }
    }
}
