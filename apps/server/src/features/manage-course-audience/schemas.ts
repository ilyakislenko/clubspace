import { z } from 'zod'

import { PrismaService } from '../../infrastructure/prisma'
import {
    audienceRowSelect,
    describeAudience,
} from '../../domains/playlist/services/course-audience'
import { NotFoundError } from '../../shared/errors/shared.errors'

// The course editor's audience picker: the current selection plus every
// option the club has, in one read (a coach may lack the admin-only lists).
export const CourseAudienceOutputSchema = z.object({
    courseId: z.string().uuid(),
    groupIds: z.array(z.string().uuid()),
    // Minimum level per ladder (at most one per ladder).
    rankLevelIds: z.array(z.string().uuid()),
    planIds: z.array(z.string().uuid()),
    // Restrictions whose group/level/plan was deleted. They still close the
    // course for that condition until the editor saves the audience again.
    orphaned: z.object({
        groups: z.number().int(),
        rankLevels: z.number().int(),
        plans: z.number().int(),
    }),
    // Human summary, null = open to the whole club.
    summary: z.string().nullable(),
    options: z.object({
        groups: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
        ladders: z.array(
            z.object({
                id: z.string().uuid(),
                name: z.string(),
                isActive: z.boolean(),
                levels: z.array(
                    z.object({
                        id: z.string().uuid(),
                        name: z.string(),
                        order: z.number().int(),
                        color: z.string().nullable(),
                        isActive: z.boolean(),
                    }),
                ),
            }),
        ),
        plans: z.array(
            z.object({
                id: z.string().uuid(),
                name: z.string(),
                isActive: z.boolean(),
            }),
        ),
    }),
})
export type CourseAudienceOutput = z.infer<typeof CourseAudienceOutputSchema>

// Shared by the GET and the PUT (which answers with the saved state).
export const loadCourseAudience = async (
    prisma: PrismaService,
    workspaceId: string,
    courseId: string,
): Promise<CourseAudienceOutput> => {
    const course = await prisma.course.findFirst({
        where: { id: courseId, workspaceId },
        select: { id: true, audience: { select: audienceRowSelect } },
    })
    if (!course) {
        throw new NotFoundError({ message: 'Курс не найден' })
    }

    const [groups, ladders, plans] = await Promise.all([
        prisma.group.findMany({
            where: { workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        }),
        prisma.rankLadder.findMany({
            where: { workspaceId },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
            select: {
                id: true,
                name: true,
                isActive: true,
                levels: {
                    orderBy: { order: 'asc' },
                    select: {
                        id: true,
                        name: true,
                        order: true,
                        color: true,
                        isActive: true,
                    },
                },
            },
        }),
        prisma.plan.findMany({
            where: { workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, isActive: true },
        }),
    ])

    const rows = course.audience
    const idsOf = (kind: string, pick: (r: (typeof rows)[number]) => string | null) =>
        rows
            .filter((r) => r.kind === kind)
            .map(pick)
            .filter((id): id is string => id !== null)
    const orphans = (kind: string, pick: (r: (typeof rows)[number]) => string | null) =>
        rows.filter((r) => r.kind === kind && pick(r) === null).length

    return {
        courseId: course.id,
        groupIds: idsOf('GROUP', (r) => r.groupId),
        rankLevelIds: idsOf('RANK', (r) => r.rankLevelId),
        planIds: idsOf('PLAN', (r) => r.planId),
        orphaned: {
            groups: orphans('GROUP', (r) => r.groupId),
            rankLevels: orphans('RANK', (r) => r.rankLevelId),
            plans: orphans('PLAN', (r) => r.planId),
        },
        summary: describeAudience(rows),
        options: { groups, ladders, plans },
    }
}
