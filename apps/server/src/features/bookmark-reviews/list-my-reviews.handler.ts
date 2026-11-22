import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { visibleVideoCourseSelect } from '../../domains/playlist/services/video-course-pick'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { serializeMyVideoBookmark } from '../manage-my-video-bookmarks/schemas'
import {
    ListMyReviewsFeature,
    ListMyReviewsFeatureResponse,
    MY_REVIEWS_LIMIT,
    MY_REVIEWS_UPCOMING_DAYS,
} from './list-my-reviews.feature'
import { NEW_CARD, previewIntervals } from './review-scheduler'
import { serializeBookmarkReview } from './schemas'

const DAY_MS = 24 * 60 * 60 * 1000

@Feature(ListMyReviewsFeature)
export class ListMyReviewsHandler
    implements IFeatureHandler<ListMyReviewsFeature, ListMyReviewsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({
        userId,
        workspaceId,
        isStaff,
    }: ListMyReviewsFeature): Promise<ListMyReviewsFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)

        const now = Date.now()
        // Tombstones (deleted on some device) never come back for review.
        const saved = await this.prisma.videoBookmark.findMany({
            where: { userId, workspaceId, deletedAt: null },
            include: { review: true },
        })
        // A lesson the member may no longer watch (course unpublished, left
        // the group, progression, videos closed) is neither shown nor counted
        // — the same gate as playback. Staff see every lesson.
        const watchable = isStaff
            ? null
            : await this.courseAccess.watchableVideoIds(
                  workspaceId,
                  userId,
                  saved.map((b) => b.videoId),
              )
        const bookmarks = watchable
            ? saved.filter((b) => watchable.has(b.videoId))
            : saved
        const cards = bookmarks.map((bookmark) => {
            const schedule = serializeBookmarkReview(bookmark, bookmark.review)
            return { bookmark, schedule, dueAt: Date.parse(schedule.dueAt) }
        })

        const due = cards
            .filter((c) => c.dueAt <= now)
            .sort(
                (a, b) =>
                    a.dueAt - b.dueAt ||
                    a.bookmark.createdAt.getTime() - b.bookmark.createdAt.getTime() ||
                    a.bookmark.id.localeCompare(b.bookmark.id),
            )
        const later = cards.filter((c) => c.dueAt > now)
        const horizon = now + MY_REVIEWS_UPCOMING_DAYS * DAY_MS
        const nextDue = later.length > 0 ? Math.min(...later.map((c) => c.dueAt)) : null
        const summary = {
            dueCount: due.length,
            upcomingCount: later.filter((c) => c.dueAt <= horizon).length,
            nextDueAt: nextDue === null ? null : new Date(nextDue).toISOString(),
            totalCount: bookmarks.length,
        }

        const page = due.slice(0, MY_REVIEWS_LIMIT)
        if (page.length === 0) return { items: [], ...summary }

        const viewer = await this.courseAccess.loadViewer({
            workspaceId,
            userId,
            isStaff,
        })
        const videos = await this.prisma.video.findMany({
            where: {
                id: { in: [...new Set(page.map((c) => c.bookmark.videoId))] },
                workspaceId,
            },
            select: {
                id: true,
                title: true,
                thumbnailUrl: true,
                duration: true,
                courses: visibleVideoCourseSelect(viewer),
            },
        })
        const videoById = new Map(videos.map((v) => [v.id, v]))

        const items = page.flatMap(({ bookmark, schedule }) => {
            const video = videoById.get(bookmark.videoId)
            if (!video) return []
            const course = video.courses[0]?.course ?? null
            return [
                {
                    bookmark: serializeMyVideoBookmark(bookmark),
                    video: {
                        id: video.id,
                        title: video.title,
                        thumbnailUrl: video.thumbnailUrl,
                        duration: video.duration,
                    },
                    course: course ? { id: course.id, title: course.title } : null,
                    schedule,
                    nextIntervals: previewIntervals(bookmark.review ?? NEW_CARD),
                },
            ]
        })
        return { items, ...summary }
    }
}
