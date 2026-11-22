import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ListTechniquesFeature,
    ListTechniquesFeatureResponse,
} from './list-techniques.feature'
import { loadTechniqueScope } from './techniques-access'
import { summarizeTechniques } from './techniques-utils'

@Feature(ListTechniquesFeature)
export class ListTechniquesHandler
    implements IFeatureHandler<ListTechniquesFeature, ListTechniquesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(f: ListTechniquesFeature): Promise<ListTechniquesFeatureResponse> {
        const { techniques, videoIds } = await loadTechniqueScope(
            this.prisma,
            this.courseAccess,
            f,
        )
        if (techniques.length === 0 || videoIds.length === 0) return { categories: [] }
        const where = { workspaceId: f.workspaceId, videoId: { in: videoIds } }
        const [counts, videos] = await Promise.all([
            this.prisma.videoTechniqueMention.groupBy({
                by: ['technique', 'kind'],
                where,
                _count: { _all: true },
            }),
            this.prisma.videoTechniqueMention.groupBy({
                by: ['technique', 'videoId'],
                where,
            }),
        ])
        return {
            categories: summarizeTechniques(techniques, counts, videos, f.payload.q ?? ''),
        }
    }
}
