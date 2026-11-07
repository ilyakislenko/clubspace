import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import {
    ListMyStudyPlansFeature,
    ListMyStudyPlansFeatureResponse,
} from './list-my-study-plans.feature'

@Feature(ListMyStudyPlansFeature)
export class ListMyStudyPlansHandler
    implements
        IFeatureHandler<ListMyStudyPlansFeature, ListMyStudyPlansFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({
        userId,
        workspaceId,
    }: ListMyStudyPlansFeature): Promise<ListMyStudyPlansFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)
        const plans = await this.prisma.studyPlan.findMany({
            where: { userId, workspaceId },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            include: {
                _count: { select: { items: true } },
                items: {
                    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                    take: 1,
                    select: { video: { select: { id: true, thumbnailUrl: true } } },
                },
            },
        })
        const watchable = await this.courseAccess.watchableVideoIds(
            workspaceId,
            userId,
            plans.flatMap((p) => p.items.map((i) => i.video.id)),
        )
        return {
            items: plans.map((plan) => {
                const first = plan.items[0]?.video
                return {
                    id: plan.id,
                    title: plan.title,
                    description: plan.description,
                    itemCount: plan._count.items,
                    coverUrl:
                        first && watchable.has(first.id) ? first.thumbnailUrl : null,
                    createdAt: plan.createdAt.toISOString(),
                    updatedAt: plan.updatedAt.toISOString(),
                }
            }),
        }
    }
}
