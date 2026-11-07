import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { visibleVideoCourseSelect } from '../../domains/playlist/services/video-course-pick'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import {
    SearchVideosFeature,
    SearchVideosFeatureResponse,
} from './search-videos.feature'
import { searchVideosSql } from './search-videos.sql'
import {
    findHit,
    likePattern,
    MAX_SEARCH_RESULTS,
    pickMoments,
    rankVideoHits,
    type VideoHitRow,
} from './search-videos-utils'

/**
 * «Поиск по видео»: the club's ready videos this member may watch (staff:
 * all), searched by title, chapter titles and what's said — the transcript
 * and its Russian translation.
 */
@Feature(SearchVideosFeature)
export class SearchVideosHandler
    implements IFeatureHandler<SearchVideosFeature, SearchVideosFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({
        userId,
        workspaceId,
        payload,
        isStaff,
    }: SearchVideosFeature): Promise<SearchVideosFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)
        const query = payload.q.trim()

        const ready = await this.prisma.video.findMany({
            where: { workspaceId, status: 'ready' },
            select: { id: true },
        })
        const watchable = await this.courseAccess.watchableVideoIds(
            workspaceId,
            userId,
            ready.map((v) => v.id),
        )
        if (watchable.size === 0) return { query, items: [] }

        const rows = await this.prisma.$queryRaw<VideoHitRow[]>(
            searchVideosSql({
                workspaceId,
                videoIds: [...watchable],
                pattern: likePattern(query),
            }),
        )
        const top = rankVideoHits(rows).slice(0, MAX_SEARCH_RESULTS)
        if (top.length === 0) return { query, items: [] }

        const viewer = await this.courseAccess.loadViewer({
            workspaceId,
            userId,
            isStaff,
        })
        const courses = await this.prisma.video.findMany({
            where: { id: { in: top.map((r) => r.id) }, workspaceId },
            select: { id: true, courses: visibleVideoCourseSelect(viewer) },
        })
        const courseOf = new Map(
            courses.map((v) => [v.id, v.courses[0]?.course ?? null]),
        )

        return {
            query,
            items: top.map((row) => {
                const course = courseOf.get(row.id) ?? null
                return {
                    video: {
                        id: row.id,
                        title: row.title,
                        thumbnailUrl: row.thumbnailUrl,
                        duration: row.duration,
                    },
                    course: course ? { id: course.id, title: course.title } : null,
                    titleHighlight: row.titleHit ? findHit(row.title, query) : null,
                    chapterHits: row.chapterHits,
                    speechHits: row.speechHits + row.speechRuHits,
                    moments: pickMoments(row, query),
                }
            }),
        }
    }
}
