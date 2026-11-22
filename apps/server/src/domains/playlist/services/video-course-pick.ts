import { buildCourseAudienceWhere, type CourseViewer } from './course-audience'
import { buildCourseVisibilityClauses } from './playlist-visibility'

/**
 * `Video.courses` select for "the course this lesson belongs to" in the
 * member's personal study lists («Мои заметки», «Повторение»): the oldest
 * course this viewer could open from the course list (published, not hidden
 * by a group/direction audience; staff see drafts and every audience).
 * Read the pick as `video.courses[0]?.course ?? null`.
 */
export const visibleVideoCourseSelect = (viewer: CourseViewer) => ({
    where: {
        course: {
            AND: [
                ...buildCourseVisibilityClauses({
                    includeUnpublished: viewer.isStaff,
                }),
                ...buildCourseAudienceWhere(viewer),
            ],
        },
    },
    orderBy: { course: { createdAt: 'asc' as const } },
    take: 1,
    select: { course: { select: { id: true, title: true } } },
})
