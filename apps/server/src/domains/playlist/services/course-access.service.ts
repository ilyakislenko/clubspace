import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import {
    type RoleName,
    STAFF_ROLES,
} from '../../../shared/decorators/roles.decorator'
import {
    ForbiddenError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { isSubscriptionUsable } from '../../subscriptions/subscription-status'
import {
    audienceRowSelect,
    type CourseLock,
    type CourseViewer,
    computeProgressionLocks,
    evaluateCourseAudience,
    PROGRESSION_LOCK_REASON,
    STAFF_VIEWER,
} from './course-audience'
import { buildCourseVisibilityClauses } from './playlist-visibility'

// Completed lessons of `userId` among `videoIds` (VideoWatched.completed is
// set by save-video-progress at ≥ 90% of the duration). Shared with
// PlaylistService, which computes the per-lesson locks of a course.
export const loadCompletedVideoIds = async (
    prisma: PrismaService,
    userId: string,
    videoIds: string[],
): Promise<Set<string>> => {
    if (videoIds.length === 0) return new Set()
    const rows = await prisma.videoWatched.findMany({
        where: { userId, videoId: { in: videoIds }, completed: true },
        select: { videoId: true },
    })
    return new Set(rows.map((r) => r.videoId))
}

// The single gate for "may this person watch this video": playback, the HLS
// manifest proxy, offline download/manifest, the member video detail and
// progress writes all go through assertCanWatchVideo, so they apply exactly
// the rules the course list applies (publishedAt, audience, progression).
@Injectable()
export class CourseAccessService {
    constructor(private readonly prisma: PrismaService) {}

    // Facts the audience rules need, in three indexed reads. Staff get the
    // shared STAFF_VIEWER and no queries.
    async loadViewer(params: {
        workspaceId: string
        userId: string
        isStaff: boolean
    }): Promise<CourseViewer> {
        if (params.isStaff) return STAFF_VIEWER
        const { workspaceId, userId } = params
        const [groups, subscriptions, promotions] = await Promise.all([
            this.prisma.groupMember.findMany({
                where: { userId, group: { workspaceId } },
                select: { groupId: true },
            }),
            this.prisma.subscription.findMany({
                where: {
                    workspaceId,
                    status: 'ACTIVE',
                    workspaceMember: { userId },
                },
                select: { planId: true, status: true, endDate: true },
            }),
            this.prisma.rankPromotion.findMany({
                where: { workspaceId, userId },
                orderBy: { awardedAt: 'desc' },
                select: { ladderId: true, level: { select: { order: true } } },
            }),
        ])
        const now = new Date()
        const rankOrderByLadder = new Map<string, number>()
        // Newest first: the first promotion seen per ladder is the current one.
        for (const p of promotions) {
            if (!rankOrderByLadder.has(p.ladderId)) {
                rankOrderByLadder.set(p.ladderId, p.level.order)
            }
        }
        return {
            isStaff: false,
            groupIds: new Set(groups.map((g) => g.groupId)),
            planIds: new Set(
                subscriptions
                    .filter((s) => isSubscriptionUsable(s, now))
                    .map((s) => s.planId),
            ),
            rankOrderByLadder,
        }
    }

    // Membership gate shared by every video route that takes a bare video id:
    // the owner (no WorkspaceMember row in the normal creation flow) passes,
    // otherwise an ACTIVE, non-expired membership is required, and students
    // are refused while the club has videos switched off.
    async resolveMemberAccess(
        workspaceId: string,
        userId: string,
    ): Promise<{ isStaff: boolean }> {
        const [workspaceRow, membership] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true, videosEnabled: true },
            }),
            this.prisma.workspaceMember.findUnique({
                where: { userId_workspaceId: { userId, workspaceId } },
                select: {
                    status: true,
                    accessUntil: true,
                    role: { select: { name: true } },
                },
            }),
        ])

        if (workspaceRow?.ownerId === userId) return { isStaff: true }
        if (!membership) {
            throw new ForbiddenError({
                message: 'Вы не участник этого клуба',
            })
        }
        if (membership.status !== 'ACTIVE') {
            throw new ForbiddenError({ message: 'Участник неактивен' })
        }
        if (membership.accessUntil && membership.accessUntil < new Date()) {
            throw new ForbiddenError({ message: 'Срок доступа истёк' })
        }
        const isStaff = STAFF_ROLES.includes(
            (membership.role?.name ?? '') as RoleName,
        )
        // Staff manage the library from the admin even with videos off.
        if (workspaceRow?.videosEnabled === false && !isStaff) {
            throw new ForbiddenError({
                message: 'Видео отключены в вашем клубе',
            })
        }
        return { isStaff }
    }

    // Throws unless `userId` may watch the video: staff always may; a student
    // needs at least one published course that contains it, isn't hidden from
    // them by audience, isn't locked, and (with locked progression) has this
    // lesson unlocked. Not in any course they can see → 404 (existence stays
    // private); visible but locked → 403 with the Russian reason.
    // `visibleCourseIds` (null for staff = all) lets the video detail drop the
    // courses a student must not learn about.
    async assertCanWatchVideo(
        video: { id: string; workspaceId: string },
        userId: string,
    ): Promise<{ isStaff: boolean; visibleCourseIds: string[] | null }> {
        const access = await this.resolveMemberAccess(video.workspaceId, userId)
        if (access.isStaff) return { isStaff: true, visibleCourseIds: null }

        const placements = await this.prisma.courseVideo.findMany({
            where: {
                videoId: video.id,
                course: {
                    workspaceId: video.workspaceId,
                    AND: buildCourseVisibilityClauses({}),
                },
            },
            select: {
                courseId: true,
                course: {
                    select: {
                        lockedProgression: true,
                        audience: { select: audienceRowSelect },
                    },
                },
            },
        })
        if (placements.length === 0) {
            throw new NotFoundError({ message: 'Видео не найдено' })
        }

        const viewer = await this.loadViewer({
            workspaceId: video.workspaceId,
            userId,
            isStaff: false,
        })

        const visibleCourseIds: string[] = []
        let allowed = false
        let lock: CourseLock | null = null
        for (const placement of placements) {
            const verdict = evaluateCourseAudience(
                placement.course.audience,
                viewer,
            )
            if (verdict.hidden) continue
            visibleCourseIds.push(placement.courseId)
            if (allowed) continue
            if (verdict.lock) {
                lock ??= verdict.lock
                continue
            }
            if (
                !placement.course.lockedProgression ||
                !(await this.isLessonLocked(placement.courseId, video.id, userId))
            ) {
                allowed = true
                continue
            }
            lock ??= { kind: 'PROGRESSION', reason: PROGRESSION_LOCK_REASON }
        }

        if (allowed) return { isStaff: false, visibleCourseIds }
        if (!lock) throw new NotFoundError({ message: 'Видео не найдено' })
        throw new ForbiddenError({ message: lock.reason })
    }

    private async isLessonLocked(
        courseId: string,
        videoId: string,
        userId: string,
    ): Promise<boolean> {
        const lessons = await this.prisma.courseVideo.findMany({
            where: { courseId },
            orderBy: [{ order: 'asc' }, { videoId: 'asc' }],
            select: { videoId: true, isOptional: true },
        })
        const completed = await loadCompletedVideoIds(
            this.prisma,
            userId,
            lessons.map((l) => l.videoId),
        )
        return computeProgressionLocks(lessons, completed).has(videoId)
    }
}
