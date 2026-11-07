import { z } from 'zod'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { NotFoundError } from '../../shared/errors/shared.errors'

export const StudyPlanTitleSchema = z.string().trim().min(1).max(120)
export const StudyPlanDescriptionSchema = z.string().trim().max(2000).nullable()

export const StudyPlanItemSchema = z.object({
    id: z.string().uuid(),
    position: z.number().int(),
    videoId: z.string().uuid(),
    startSec: z.number().int(),
    // Non-null = a segment, played to here before the next item.
    endSec: z.number().int().nullable(),
    title: z.string(),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
    // Whether the member may watch the video now (published course they can
    // open, unlocked). When not, the lesson's own details stay hidden.
    accessible: z.boolean(),
    video: z
        .object({
            id: z.string().uuid(),
            title: z.string(),
            thumbnailUrl: z.string().nullable(),
            duration: z.number().int().nullable(),
        })
        .nullable(),
})

export const StudyPlanDetailSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // Play order.
    items: z.array(StudyPlanItemSchema),
})

export type StudyPlanDetail = z.infer<typeof StudyPlanDetailSchema>

type PlanRow = {
    id: string
    userId: string
    workspaceId: string
    title: string
    description: string | null
    createdAt: Date
    updatedAt: Date
}

/**
 * The caller's own plan in this club, after the membership gate. Someone
 * else's plan (or another club's) is indistinguishable from a missing one.
 */
export async function loadOwnPlan(
    prisma: PrismaService,
    params: { userId: string; workspaceId: string; planId: string },
): Promise<PlanRow> {
    await assertActiveWorkspaceMembership(prisma, params.userId, params.workspaceId)
    const plan = await prisma.studyPlan.findUnique({ where: { id: params.planId } })
    if (
        !plan ||
        plan.userId !== params.userId ||
        plan.workspaceId !== params.workspaceId
    ) {
        throw new NotFoundError({ message: 'План не найден' })
    }
    return plan
}

/** Bumps the plan's updatedAt after an item change (list order = activity). */
export const touchPlan = (prisma: PrismaService, planId: string) =>
    prisma.studyPlan.update({
        where: { id: planId },
        data: { updatedAt: new Date() },
    })

/** The plan with its items in play order, each flagged watchable or not. */
export async function loadPlanDetail(
    prisma: PrismaService,
    courseAccess: CourseAccessService,
    plan: PlanRow,
): Promise<StudyPlanDetail> {
    const items = await prisma.studyPlanItem.findMany({
        where: { planId: plan.id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: {
            video: {
                select: { id: true, title: true, thumbnailUrl: true, duration: true },
            },
        },
    })
    const watchable = await courseAccess.watchableVideoIds(
        plan.workspaceId,
        plan.userId,
        items.map((i) => i.videoId),
    )
    return {
        id: plan.id,
        title: plan.title,
        description: plan.description,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        items: items.map((item) => {
            const accessible = watchable.has(item.videoId)
            return {
                id: item.id,
                position: item.position,
                videoId: item.videoId,
                startSec: item.startSec,
                endSec: item.endSec,
                title: item.title,
                note: item.note,
                createdAt: item.createdAt.toISOString(),
                accessible,
                video: accessible
                    ? {
                          id: item.video.id,
                          title: item.video.title,
                          thumbnailUrl: item.video.thumbnailUrl,
                          duration: item.video.duration,
                      }
                    : null,
            }
        }),
    }
}
