jest.mock('../../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import {
    ForbiddenError,
    ModuleNotEntitledError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { CourseAccessService } from './course-access.service'

const VIDEO = { id: 'v2', workspaceId: 'ws-1' }

type Placement = {
    courseId: string
    course: {
        lockedProgression: boolean
        audience: Array<Record<string, unknown>>
    }
}

const open = (courseId = 'c1', lockedProgression = false): Placement => ({
    courseId,
    course: { lockedProgression, audience: [] },
})

const groupOnly = (courseId: string, groupId: string): Placement => ({
    courseId,
    course: {
        lockedProgression: false,
        audience: [
            {
                kind: 'GROUP',
                groupId,
                rankLevelId: null,
                planId: null,
                group: { name: 'Дети' },
                rankLevel: null,
                plan: null,
            },
        ],
    },
})

const directionOnly = (courseId: string, directionId: string): Placement => ({
    courseId,
    course: {
        lockedProgression: false,
        audience: [
            {
                kind: 'DIRECTION',
                groupId: null,
                rankLevelId: null,
                planId: null,
                directionId,
                group: null,
                direction: { name: 'БЖЖ' },
                rankLevel: null,
                plan: null,
            },
        ],
    },
})

const rankOnly = (courseId: string, order: number): Placement => ({
    courseId,
    course: {
        lockedProgression: false,
        audience: [
            {
                kind: 'RANK',
                groupId: null,
                rankLevelId: 'lvl',
                planId: null,
                group: null,
                rankLevel: {
                    name: 'Синий пояс',
                    order,
                    ladderId: 'ladder',
                    ladder: { name: 'Взрослые' },
                },
                plan: null,
            },
        ],
    },
})

const build = (o: {
    ownerId?: string
    videosEnabled?: boolean
    // Billing row of the club; null = trial (every module on).
    billing?: { status: string } | null
    member?: unknown
    placements?: Placement[]
    groupIds?: string[]
    // Directions of the groups the student trains in.
    directionIds?: string[]
    subscriptions?: Array<{ planId: string; status: string; endDate: Date | null }>
    promotions?: Array<{ ladderId: string; level: { order: number } }>
    lessons?: Array<{ courseId: string; videoId: string; isOptional: boolean }>
    completed?: string[]
} = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: o.ownerId ?? 'owner-1',
                videosEnabled: o.videosEnabled ?? true,
                billing: o.billing ?? null,
                moduleEntitlements: [],
            }),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(
                'member' in o
                    ? o.member
                    : { status: 'ACTIVE', accessUntil: null, role: { name: 'user' } },
            ),
        },
        courseVideo: {
            findMany: jest
                .fn()
                // 1st call: placements of the video; 2nd: lessons of the
                // locked courses.
                .mockResolvedValueOnce(o.placements ?? [open()])
                .mockResolvedValue(
                    o.lessons ?? [
                        { courseId: 'c1', videoId: 'v1', isOptional: false },
                        { courseId: 'c1', videoId: 'v2', isOptional: false },
                    ],
                ),
        },
        groupMember: {
            // The viewer's groups, or (selecting the group) their directions.
            findMany: jest.fn(async (args: { select: { group?: unknown } }) =>
                args.select.group
                    ? (o.directionIds ?? []).map((directionId) => ({
                          group: { directionId },
                      }))
                    : (o.groupIds ?? []).map((groupId) => ({ groupId })),
            ),
        },
        groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
        subscription: {
            findMany: jest.fn().mockResolvedValue(o.subscriptions ?? []),
        },
        rankPromotion: {
            findMany: jest.fn().mockResolvedValue(o.promotions ?? []),
        },
        videoWatched: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.completed ?? []).map((videoId) => ({ videoId }))),
        },
    }
    return { service: new CourseAccessService(prisma as never), prisma }
}

describe('CourseAccessService.resolveMemberAccess', () => {
    it('lets the owner in without a membership row', async () => {
        const { service } = build({ member: null })
        await expect(
            service.resolveMemberAccess('ws-1', 'owner-1'),
        ).resolves.toEqual({ isStaff: true })
    })

    it('refuses a non-member, an inactive member and an expired window', async () => {
        for (const member of [
            null,
            { status: 'BLOCKED', accessUntil: null, role: { name: 'user' } },
            {
                status: 'ACTIVE',
                accessUntil: new Date('2000-01-01'),
                role: { name: 'user' },
            },
        ]) {
            const { service } = build({ member })
            await expect(
                service.resolveMemberAccess('ws-1', 'u1'),
            ).rejects.toBeInstanceOf(ForbiddenError)
        }
    })

    it('refuses students but not coaches while videos are off', async () => {
        const { service } = build({ videosEnabled: false })
        await expect(service.resolveMemberAccess('ws-1', 'u1')).rejects.toThrow(
            'Видео отключены в вашем клубе',
        )
        const coach = build({
            videosEnabled: false,
            member: { status: 'ACTIVE', accessUntil: null, role: { name: 'coach' } },
        })
        await expect(
            coach.service.resolveMemberAccess('ws-1', 'u1'),
        ).resolves.toEqual({ isStaff: true })
    })

    it('refuses students but not coaches when VIDEO is not entitled', async () => {
        const { service } = build({ billing: { status: 'ACTIVE' } })
        await expect(
            service.resolveMemberAccess('ws-1', 'u1'),
        ).rejects.toBeInstanceOf(ModuleNotEntitledError)
        const coach = build({
            billing: { status: 'ACTIVE' },
            member: { status: 'ACTIVE', accessUntil: null, role: { name: 'coach' } },
        })
        await expect(
            coach.service.resolveMemberAccess('ws-1', 'u1'),
        ).resolves.toEqual({ isStaff: true })
    })
})

describe('CourseAccessService.loadViewer', () => {
    it('returns the staff viewer without querying', async () => {
        const { service, prisma } = build()
        const viewer = await service.loadViewer({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: true,
        })
        expect(viewer.isStaff).toBe(true)
        expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
    })

    it('keeps the newest level per ladder and asks only for current abonements', async () => {
        const { service, prisma } = build({
            groupIds: ['g1'],
            promotions: [
                { ladderId: 'ladder', level: { order: 3 } },
                { ladderId: 'ladder', level: { order: 1 } },
            ],
            // What the current-abonement filter returns.
            subscriptions: [{ planId: 'live', status: 'ACTIVE', endDate: null }],
        })
        const viewer = await service.loadViewer({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: false,
        })
        expect([...viewer.groupIds]).toEqual(['g1'])
        expect([...viewer.directionIds]).toEqual([])
        expect(viewer.rankOrderByLadder.get('ladder')).toBe(3)
        expect([...viewer.planIds]).toEqual(['live'])
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'ws-1',
            workspaceMember: { userId: 'u1' },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        })
    })

    it('a PLAN audience matches any of several current abonements', async () => {
        const { service } = build({
            subscriptions: [
                { planId: 'bjj-12', status: 'ACTIVE', endDate: null },
                { planId: 'muay-8', status: 'ACTIVE', endDate: null },
            ],
        })
        const viewer = await service.loadViewer({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: false,
        })
        expect([...viewer.planIds].sort()).toEqual(['bjj-12', 'muay-8'])
    })
})

describe('CourseAccessService directions', () => {
    it('loads the directions of the student’s groups', async () => {
        const { service, prisma } = build({ directionIds: ['d1'] })
        const viewer = await service.loadViewer({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: false,
        })
        expect([...viewer.directionIds]).toEqual(['d1'])
        expect(prisma.groupCoach.findMany).toHaveBeenCalled()
    })

    it('hides a direction course from a student of another direction', async () => {
        const { service } = build({
            placements: [directionOnly('c1', 'd1')],
            directionIds: ['d2'],
        })
        await expect(
            service.assertCanWatchVideo(VIDEO, 'u1'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('opens a direction course to a student of that direction', async () => {
        const { service } = build({
            placements: [directionOnly('c1', 'd1')],
            directionIds: ['d1'],
        })
        await expect(service.assertCanWatchVideo(VIDEO, 'u1')).resolves.toEqual({
            isStaff: false,
            visibleCourseIds: ['c1'],
        })
    })
})

describe('CourseAccessService.assertCanWatchVideo', () => {
    it('lets staff watch anything without looking at courses', async () => {
        const { service, prisma } = build({ member: null })
        await expect(
            service.assertCanWatchVideo(VIDEO, 'owner-1'),
        ).resolves.toEqual({ isStaff: true, visibleCourseIds: null })
        expect(prisma.courseVideo.findMany).not.toHaveBeenCalled()
    })

    it('looks only at published courses of the video club', async () => {
        const { service, prisma } = build()
        await service.assertCanWatchVideo(VIDEO, 'u1')
        const where = prisma.courseVideo.findMany.mock.calls[0][0].where
        expect(where.videoId).toBe('v2')
        expect(where.course.workspaceId).toBe('ws-1')
        expect(where.course.AND[0].publishedAt.lte).toBeInstanceOf(Date)
    })

    it('404s a video in no published course', async () => {
        const { service } = build({ placements: [] })
        await expect(
            service.assertCanWatchVideo(VIDEO, 'u1'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s a video whose only course is hidden by group', async () => {
        const { service } = build({ placements: [groupOnly('c1', 'g1')] })
        await expect(
            service.assertCanWatchVideo(VIDEO, 'u1'),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('403s with the reason when the course is a rank teaser', async () => {
        const { service } = build({ placements: [rankOnly('c1', 2)] })
        await expect(service.assertCanWatchVideo(VIDEO, 'u1')).rejects.toThrow(
            'Доступно с уровня «Синий пояс»',
        )
    })

    it('opens once the student is promoted to the level', async () => {
        const { service } = build({
            placements: [rankOnly('c1', 2)],
            promotions: [{ ladderId: 'ladder', level: { order: 2 } }],
        })
        await expect(service.assertCanWatchVideo(VIDEO, 'u1')).resolves.toEqual({
            isStaff: false,
            visibleCourseIds: ['c1'],
        })
    })

    it('passes through any open course and lists only visible ones', async () => {
        const { service } = build({
            placements: [groupOnly('hidden', 'g9'), rankOnly('teaser', 5), open('c3')],
        })
        await expect(service.assertCanWatchVideo(VIDEO, 'u1')).resolves.toEqual({
            isStaff: false,
            visibleCourseIds: ['teaser', 'c3'],
        })
    })

    it('403s a lesson locked by progression until the previous is watched', async () => {
        const locked = build({ placements: [open('c1', true)] })
        await expect(
            locked.service.assertCanWatchVideo(VIDEO, 'u1'),
        ).rejects.toThrow('Сначала посмотрите предыдущий урок')
        expect(locked.prisma.courseVideo.findMany.mock.calls[1][0]).toEqual({
            where: { courseId: { in: ['c1'] } },
            orderBy: [{ order: 'asc' }, { videoId: 'asc' }],
            select: { courseId: true, videoId: true, isOptional: true },
        })

        const unlocked = build({ placements: [open('c1', true)], completed: ['v1'] })
        await expect(
            unlocked.service.assertCanWatchVideo(VIDEO, 'u1'),
        ).resolves.toEqual({ isStaff: false, visibleCourseIds: ['c1'] })
    })
})

describe('CourseAccessService.watchableVideoIds', () => {
    const on = (videoId: string, p: Placement) => ({ videoId, ...p })

    it('gives staff every video without looking at courses', async () => {
        const { service, prisma } = build({ member: null })
        await expect(
            service.watchableVideoIds('ws-1', 'owner-1', ['v1', 'v2', 'v1']),
        ).resolves.toEqual(new Set(['v1', 'v2']))
        expect(prisma.courseVideo.findMany).not.toHaveBeenCalled()
    })

    it('gives nothing while the club has videos closed to the student', async () => {
        const { service, prisma } = build({ videosEnabled: false })
        await expect(service.watchableVideoIds('ws-1', 'u1', ['v1'])).resolves.toEqual(
            new Set(),
        )
        expect(prisma.courseVideo.findMany).not.toHaveBeenCalled()
    })

    it('gives nothing to a non-member', async () => {
        const { service } = build({ member: null })
        await expect(service.watchableVideoIds('ws-1', 'u1', ['v1'])).resolves.toEqual(
            new Set(),
        )
    })

    it('keeps only videos in a published course the student can open', async () => {
        const { service, prisma } = build({
            placements: [
                on('v1', open('c1')),
                on('v2', groupOnly('c2', 'g9')),
                on('v4', rankOnly('c4', 3)),
            ] as never,
        })
        await expect(
            service.watchableVideoIds('ws-1', 'u1', ['v1', 'v2', 'v3', 'v4']),
        ).resolves.toEqual(new Set(['v1']))
        const where = prisma.courseVideo.findMany.mock.calls[0][0].where
        expect(where.videoId).toEqual({ in: ['v1', 'v2', 'v3', 'v4'] })
        expect(where.course.workspaceId).toBe('ws-1')
        expect(where.course.AND[0].publishedAt.lte).toBeInstanceOf(Date)
    })

    it('applies progression locks', async () => {
        const locked = build({ placements: [on('v2', open('c1', true))] as never })
        await expect(
            locked.service.watchableVideoIds('ws-1', 'u1', ['v2']),
        ).resolves.toEqual(new Set())
        const unlocked = build({
            placements: [on('v2', open('c1', true))] as never,
            completed: ['v1'],
        })
        await expect(
            unlocked.service.watchableVideoIds('ws-1', 'u1', ['v2']),
        ).resolves.toEqual(new Set(['v2']))
    })

    it('asks nothing for an empty list', async () => {
        const { service, prisma } = build()
        await expect(service.watchableVideoIds('ws-1', 'u1', [])).resolves.toEqual(
            new Set(),
        )
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
    })
})

// A small course catalog behind courseVideo / videoWatched, answering by the
// query's `where` (not call order), so the single gate and the batch can be
// run on the same data and compared.
type CatalogCourse = {
    lockedProgression?: boolean
    audience?: Placement['course']['audience']
    // undefined = published long ago; null = draft.
    publishedAt?: Date | null
}
type CatalogRow = { videoId: string; courseId: string; order: number; isOptional?: boolean }
type IdFilter = string | { in: string[] }

const catalog = (o: {
    courses: Record<string, CatalogCourse>
    rows: CatalogRow[]
    completed?: string[]
    groupIds?: string[]
    member?: unknown
}) => {
    const built = build({
        groupIds: o.groupIds,
        ...('member' in o ? { member: o.member } : {}),
    })
    const now = new Date()
    const published = (courseId: string) => {
        const at = o.courses[courseId].publishedAt
        return at !== null && (at ?? new Date(0)) <= now
    }
    built.prisma.courseVideo.findMany.mockReset().mockImplementation(
        async ({
            where,
        }: {
            where: { course?: unknown; videoId: IdFilter; courseId: IdFilter }
        }) => {
            if (where.course) {
                // Placements: rows of the asked videos in published courses.
                const ids =
                    typeof where.videoId === 'string' ? [where.videoId] : where.videoId.in
                return o.rows
                    .filter((r) => ids.includes(r.videoId) && published(r.courseId))
                    .map((r) => ({
                        videoId: r.videoId,
                        courseId: r.courseId,
                        course: {
                            lockedProgression:
                                o.courses[r.courseId].lockedProgression ?? false,
                            audience: o.courses[r.courseId].audience ?? [],
                        },
                    }))
            }
            // Lessons of courses, in course order.
            const courseIds =
                typeof where.courseId === 'string' ? [where.courseId] : where.courseId.in
            return o.rows
                .filter((r) => courseIds.includes(r.courseId))
                .sort((a, b) => a.order - b.order || a.videoId.localeCompare(b.videoId))
                .map((r) => ({
                    courseId: r.courseId,
                    videoId: r.videoId,
                    isOptional: r.isOptional ?? false,
                }))
        },
    )
    built.prisma.videoWatched.findMany.mockReset().mockImplementation(
        async ({ where }: { where: { videoId: { in: string[] } } }) =>
            (o.completed ?? [])
                .filter((id) => where.videoId.in.includes(id))
                .map((videoId) => ({ videoId })),
    )
    return built
}

// Every Prisma call the service made, by model.
const queryCounts = (prisma: Record<string, Record<string, jest.Mock>>) => {
    const counts: Record<string, number> = {}
    let total = 0
    for (const [model, methods] of Object.entries(prisma)) {
        for (const fn of Object.values(methods)) {
            counts[model] = (counts[model] ?? 0) + fn.mock.calls.length
            total += fn.mock.calls.length
        }
    }
    return { ...counts, total }
}

describe('CourseAccessService batch vs single gate', () => {
    const MIXED = {
        courses: {
            // a1 done → a2 (optional) and a3 open; a4 waits for a3.
            L: { lockedProgression: true },
            // Nothing done → b2 waits for b1.
            L2: { lockedProgression: true },
            // b2 is the first lesson here, but the course is hidden by group.
            L3: { lockedProgression: true, audience: groupOnly('L3', 'g9').course.audience },
            O: {},
            R: { audience: rankOnly('R', 2).course.audience },
            G9: { audience: groupOnly('G9', 'g9').course.audience },
            G1: { audience: groupOnly('G1', 'g1').course.audience },
            // A draft / scheduled course opens nothing, a4 included.
            D: { publishedAt: null },
            F: { publishedAt: new Date('2999-01-01') },
        },
        rows: [
            { videoId: 'a1', courseId: 'L', order: 1 },
            { videoId: 'a2', courseId: 'L', order: 2, isOptional: true },
            { videoId: 'a3', courseId: 'L', order: 3 },
            { videoId: 'a4', courseId: 'L', order: 4 },
            { videoId: 'b1', courseId: 'L2', order: 1 },
            { videoId: 'b2', courseId: 'L2', order: 2 },
            { videoId: 'b2', courseId: 'L3', order: 1 },
            { videoId: 'both', courseId: 'R', order: 1 },
            { videoId: 'both', courseId: 'O', order: 1 },
            { videoId: 'r1', courseId: 'R', order: 2 },
            { videoId: 'h1', courseId: 'G9', order: 1 },
            { videoId: 'gv1', courseId: 'G1', order: 1 },
            { videoId: 'd1', courseId: 'D', order: 1 },
            { videoId: 'a4', courseId: 'D', order: 2 },
            { videoId: 'f1', courseId: 'F', order: 1 },
        ],
        completed: ['a1'],
        groupIds: ['g1'],
    }
    const VIDEOS = [...new Set(MIXED.rows.map((r) => r.videoId)), 'nowhere']

    const singleGate = async (userId: string, member?: unknown) => {
        const allowed = new Set<string>()
        for (const id of VIDEOS) {
            const { service } = catalog({
                ...MIXED,
                ...(member === undefined ? {} : { member }),
            })
            try {
                await service.assertCanWatchVideo({ id, workspaceId: 'ws-1' }, userId)
                allowed.add(id)
            } catch (e) {
                if (!(e instanceof NotFoundError || e instanceof ForbiddenError)) throw e
            }
        }
        return allowed
    }

    it('a student gets the same answer from the batch as video by video', async () => {
        const { service, prisma } = catalog(MIXED)
        const batch = await service.watchableVideoIds('ws-1', 'u1', VIDEOS)
        expect(batch).toEqual(new Set(['a1', 'a2', 'a3', 'b1', 'both', 'gv1']))
        expect(batch).toEqual(await singleGate('u1'))
        // Placements once, then every open locked course's lessons in one
        // read and the student's completions in one more.
        expect(prisma.courseVideo.findMany).toHaveBeenCalledTimes(2)
        expect(prisma.courseVideo.findMany.mock.calls[1][0].where).toEqual({
            courseId: { in: ['L', 'L2'] },
        })
        expect(prisma.videoWatched.findMany).toHaveBeenCalledTimes(1)
    })

    it('staff get everything from both', async () => {
        const { service } = catalog({ ...MIXED, member: null })
        const batch = await service.watchableVideoIds('ws-1', 'owner-1', VIDEOS)
        expect(batch).toEqual(new Set(VIDEOS))
        expect(batch).toEqual(await singleGate('owner-1', null))
    })

    it('the batch asks the same few queries for 10 or 100 lessons of a locked course', async () => {
        const run = async (n: number) => {
            const rows = Array.from({ length: n }, (_, i) => ({
                videoId: `v${i}`,
                courseId: 'L',
                order: i,
            }))
            const { service, prisma } = catalog({
                courses: { L: { lockedProgression: true } },
                rows,
                // The first half done: they and the next lesson are open.
                completed: rows.slice(0, n / 2).map((r) => r.videoId),
            })
            const watchable = await service.watchableVideoIds(
                'ws-1',
                'u1',
                rows.map((r) => r.videoId),
            )
            expect(watchable.size).toBe(n / 2 + 1)
            return queryCounts(prisma as never)
        }
        const ten = await run(10)
        const hundred = await run(100)
        expect(hundred).toEqual(ten)
        // Was 208 for 100 lessons (lessons + completions per video).
        expect(hundred).toMatchObject({ courseVideo: 2, videoWatched: 1, total: 10 })
    })
})
