jest.mock('../../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import {
    ForbiddenError,
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
    member?: unknown
    placements?: Placement[]
    groupIds?: string[]
    subscriptions?: Array<{ planId: string; status: string; endDate: Date | null }>
    promotions?: Array<{ ladderId: string; level: { order: number } }>
    lessons?: Array<{ videoId: string; isOptional: boolean }>
    completed?: string[]
} = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: o.ownerId ?? 'owner-1',
                videosEnabled: o.videosEnabled ?? true,
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
                // 1st call: placements of the video; 2nd: lessons of a course.
                .mockResolvedValueOnce(o.placements ?? [open()])
                .mockResolvedValue(
                    o.lessons ?? [
                        { videoId: 'v1', isOptional: false },
                        { videoId: 'v2', isOptional: false },
                    ],
                ),
        },
        groupMember: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.groupIds ?? []).map((groupId) => ({ groupId }))),
        },
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

    it('keeps the newest level per ladder and only usable abonements', async () => {
        const { service } = build({
            groupIds: ['g1'],
            promotions: [
                { ladderId: 'ladder', level: { order: 3 } },
                { ladderId: 'ladder', level: { order: 1 } },
            ],
            subscriptions: [
                { planId: 'live', status: 'ACTIVE', endDate: null },
                { planId: 'over', status: 'ACTIVE', endDate: new Date('2000-01-01') },
            ],
        })
        const viewer = await service.loadViewer({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: false,
        })
        expect([...viewer.groupIds]).toEqual(['g1'])
        expect(viewer.rankOrderByLadder.get('ladder')).toBe(3)
        expect([...viewer.planIds]).toEqual(['live'])
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
            where: { courseId: 'c1' },
            orderBy: [{ order: 'asc' }, { videoId: 'asc' }],
            select: { videoId: true, isOptional: true },
        })

        const unlocked = build({ placements: [open('c1', true)], completed: ['v1'] })
        await expect(
            unlocked.service.assertCanWatchVideo(VIDEO, 'u1'),
        ).resolves.toEqual({ isStaff: false, visibleCourseIds: ['c1'] })
    })
})
