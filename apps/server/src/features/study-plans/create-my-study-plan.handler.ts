import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import {
    CreateMyStudyPlanFeature,
    CreateMyStudyPlanFeatureResponse,
} from './create-my-study-plan.feature'

@Feature(CreateMyStudyPlanFeature)
export class CreateMyStudyPlanHandler
    implements
        IFeatureHandler<CreateMyStudyPlanFeature, CreateMyStudyPlanFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        userId,
        workspaceId,
        payload,
    }: CreateMyStudyPlanFeature): Promise<CreateMyStudyPlanFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)
        const plan = await this.prisma.studyPlan.create({
            data: {
                userId,
                workspaceId,
                title: payload.title,
                description: payload.description || null,
            },
        })
        return {
            id: plan.id,
            title: plan.title,
            description: plan.description,
            createdAt: plan.createdAt.toISOString(),
            updatedAt: plan.updatedAt.toISOString(),
            items: [],
        }
    }
}
