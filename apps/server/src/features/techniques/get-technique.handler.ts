import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TECHNIQUE_CATEGORY_LABELS } from '@clubspace/sport-glossary'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { visibleVideoCourseSelect } from '../../domains/playlist/services/video-course-pick'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetTechniqueFeature, GetTechniqueFeatureResponse } from './get-technique.feature'
import { loadTechniqueScope } from './techniques-access'
import { groupTechniqueMoments } from './techniques-utils'

@Feature(GetTechniqueFeature)
export class GetTechniqueHandler
    implements IFeatureHandler<GetTechniqueFeature, GetTechniqueFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute(f: GetTechniqueFeature): Promise<GetTechniqueFeatureResponse> {
        const { techniques, videoIds } = await loadTechniqueScope(
            this.prisma,
            this.courseAccess,
            f,
        )
        const technique = techniques.find((t) => t.key === f.techniqueKey)
        if (!technique) throw new NotFoundError({ message: 'Техника не найдена' })
        const summary = {
            key: technique.key,
            en: technique.en,
            ru: technique.ru,
            category: technique.category,
            categoryLabel: TECHNIQUE_CATEGORY_LABELS[technique.category],
        }
        if (videoIds.length === 0) return { technique: summary, items: [] }

        const mentions = await this.prisma.videoTechniqueMention.findMany({
            where: {
                workspaceId: f.workspaceId,
                technique: technique.key,
                videoId: { in: videoIds },
            },
            select: { videoId: true, kind: true, atSec: true, text: true, matched: true },
        })
        const groups = groupTechniqueMoments(mentions)
        if (groups.length === 0) return { technique: summary, items: [] }

        const viewer = await this.courseAccess.loadViewer({
            workspaceId: f.workspaceId,
            userId: f.userId,
            isStaff: f.isStaff,
        })
        const videos = await this.prisma.video.findMany({
            where: { id: { in: groups.map((g) => g.videoId) }, workspaceId: f.workspaceId },
            select: {
                id: true,
                title: true,
                thumbnailUrl: true,
                duration: true,
                courses: visibleVideoCourseSelect(viewer),
            },
        })
        const byId = new Map(videos.map((v) => [v.id, v]))
        return {
            technique: summary,
            items: groups.flatMap((g) => {
                const video = byId.get(g.videoId)
                if (!video) return []
                const course = video.courses[0]?.course ?? null
                return [
                    {
                        video: {
                            id: video.id,
                            title: video.title,
                            thumbnailUrl: video.thumbnailUrl,
                            duration: video.duration,
                        },
                        course: course ? { id: course.id, title: course.title } : null,
                        chapterHits: g.chapterHits,
                        speechHits: g.speechHits,
                        moments: g.moments,
                    },
                ]
            }),
        }
    }
}
