jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetCourseAudienceFeature } from './get-course-audience.feature'
import { GetCourseAudienceHandler } from './get-course-audience.handler'
import { UpdateCourseAudienceFeature } from './update-course-audience.feature'
import { UpdateCourseAudienceHandler } from './update-course-audience.handler'

const G1 = '11111111-1111-4111-8111-111111111111'
const L1 = '22222222-2222-4222-8222-222222222222'
const L2 = '33333333-3333-4333-8333-333333333333'
const P1 = '44444444-4444-4444-8444-444444444444'

const build = (o: {
    course?: unknown
    groups?: Array<{ id: string }>
    levels?: Array<{ id: string; ladderId: string }>
    plans?: Array<{ id: string }>
    audience?: unknown[]
    refuse?: boolean
} = {}) => {
    const course =
        'course' in o ? o.course : { id: 'c1', audience: o.audience ?? [] }
    const prisma = {
        course: { findFirst: jest.fn().mockResolvedValue(course) },
        group: {
            findMany: jest
                .fn()
                // 1st: validation (update only) / options (get)
                .mockResolvedValue(o.groups ?? []),
        },
        rankLevel: { findMany: jest.fn().mockResolvedValue(o.levels ?? []) },
        rankLadder: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 'ladder',
                    name: 'Взрослые',
                    isActive: true,
                    levels: [
                        { id: L1, name: 'Синий пояс', order: 1, color: '#00f', isActive: true },
                    ],
                },
            ]),
        },
        plan: { findMany: jest.fn().mockResolvedValue(o.plans ?? []) },
        courseAudience: {
            deleteMany: jest.fn().mockReturnValue('delete-op'),
            createMany: jest.fn().mockReturnValue('create-op'),
        },
        $transaction: jest.fn().mockResolvedValue([]),
    }
    const rbac = {
        resolveCoachScope: o.refuse
            ? jest
                  .fn()
                  .mockRejectedValue(
                      new ForbiddenError({ message: 'Нужны права администратора клуба' }),
                  )
            : jest.fn().mockResolvedValue({ scope: 'coach_own_only' }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    return { prisma, rbac, audit, realtime }
}

const getFeature = () =>
    new GetCourseAudienceFeature('ws-1', 'c1', 'coach-1', 'coach', false)

const updateFeature = (payload: {
    groupIds?: string[]
    rankLevelIds?: string[]
    planIds?: string[]
}) =>
    new UpdateCourseAudienceFeature(
        {
            groupIds: payload.groupIds ?? [],
            rankLevelIds: payload.rankLevelIds ?? [],
            planIds: payload.planIds ?? [],
        },
        'ws-1',
        'c1',
        'coach-1',
        'coach',
        false,
    )

describe('GetCourseAudienceHandler', () => {
    const run = (deps: ReturnType<typeof build>) =>
        new GetCourseAudienceHandler(deps.prisma as never, deps.rbac as never).execute(
            getFeature(),
        )

    it('refuses a student', async () => {
        const deps = build({ refuse: true })
        await expect(run(deps)).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.course.findFirst).not.toHaveBeenCalled()
    })

    it('404s a course of another club', async () => {
        const deps = build({ course: null })
        await expect(run(deps)).rejects.toBeInstanceOf(NotFoundError)
        expect(deps.prisma.course.findFirst.mock.calls[0][0].where).toEqual({
            id: 'c1',
            workspaceId: 'ws-1',
        })
    })

    it('returns an open course with every club option', async () => {
        const deps = build({ groups: [{ id: G1, name: 'Дети' } as never] })
        const out = await run(deps)
        expect(out).toMatchObject({
            courseId: 'c1',
            groupIds: [],
            rankLevelIds: [],
            planIds: [],
            orphaned: { groups: 0, rankLevels: 0, plans: 0 },
            summary: null,
        })
        expect(out.options.groups).toEqual([{ id: G1, name: 'Дети' }])
        expect(out.options.ladders[0].levels[0].name).toBe('Синий пояс')
    })

    it('reports selections and rows left behind by deleted targets', async () => {
        const deps = build({
            audience: [
                { kind: 'GROUP', groupId: G1, rankLevelId: null, planId: null, group: { name: 'Дети' }, rankLevel: null, plan: null },
                { kind: 'GROUP', groupId: null, rankLevelId: null, planId: null, group: null, rankLevel: null, plan: null },
                { kind: 'RANK', groupId: null, rankLevelId: L1, planId: null, group: null, rankLevel: { name: 'Синий пояс', order: 1, ladderId: 'ladder', ladder: { name: 'Взрослые' } }, plan: null },
                { kind: 'PLAN', groupId: null, rankLevelId: null, planId: null, group: null, rankLevel: null, plan: null },
            ],
        })
        const out = await run(deps)
        expect(out.groupIds).toEqual([G1])
        expect(out.rankLevelIds).toEqual([L1])
        expect(out.planIds).toEqual([])
        expect(out.orphaned).toEqual({ groups: 1, rankLevels: 0, plans: 1 })
        expect(out.summary).toBe(
            'Для группы «Дети» · Доступно с уровня «Синий пояс» · Доступно по отдельным абонементам',
        )
    })
})

describe('UpdateCourseAudienceHandler', () => {
    const run = (deps: ReturnType<typeof build>, f = updateFeature({})) =>
        new UpdateCourseAudienceHandler(
            deps.prisma as never,
            deps.rbac as never,
            deps.audit as never,
            deps.realtime as never,
        ).execute(f)

    it('refuses a student before touching anything', async () => {
        const deps = build({ refuse: true })
        await expect(run(deps)).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s a course of another club', async () => {
        const deps = build({ course: null })
        await expect(run(deps)).rejects.toBeInstanceOf(NotFoundError)
        expect(deps.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a group, level or plan from another club', async () => {
        for (const [payload, message] of [
            [{ groupIds: [G1] }, 'Группа не найдена'],
            [{ rankLevelIds: [L1] }, 'Уровень не найден'],
            [{ planIds: [P1] }, 'Абонемент не найден'],
        ] as const) {
            const deps = build()
            await expect(run(deps, updateFeature(payload))).rejects.toThrow(message)
            expect(deps.prisma.$transaction).not.toHaveBeenCalled()
        }
        const deps = build()
        await run(deps, updateFeature({ groupIds: [G1] })).catch(() => undefined)
        expect(deps.prisma.group.findMany.mock.calls[0][0].where).toEqual({
            id: { in: [G1] },
            workspaceId: 'ws-1',
        })
    })

    it('refuses two minimum levels on the same ladder', async () => {
        const deps = build({
            levels: [
                { id: L1, ladderId: 'ladder' },
                { id: L2, ladderId: 'ladder' },
            ],
        })
        await expect(
            run(deps, updateFeature({ rankLevelIds: [L1, L2] })),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('replaces the audience, audits and refreshes course lists', async () => {
        const deps = build({
            groups: [{ id: G1 }],
            levels: [{ id: L1, ladderId: 'ladder' }],
            plans: [{ id: P1 }],
        })
        await run(
            deps,
            updateFeature({ groupIds: [G1, G1], rankLevelIds: [L1], planIds: [P1] }),
        )
        expect(deps.prisma.courseAudience.deleteMany).toHaveBeenCalledWith({
            where: { courseId: 'c1' },
        })
        expect(deps.prisma.courseAudience.createMany).toHaveBeenCalledWith({
            data: [
                { courseId: 'c1', kind: 'GROUP', groupId: G1 },
                { courseId: 'c1', kind: 'RANK', rankLevelId: L1 },
                { courseId: 'c1', kind: 'PLAN', planId: P1 },
            ],
        })
        expect(deps.prisma.$transaction).toHaveBeenCalledWith([
            'delete-op',
            'create-op',
        ])
        expect(deps.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'playlist.update',
                targetId: 'c1',
                metadata: expect.objectContaining({ fields: ['audience'] }),
            }),
        )
        expect(deps.realtime.invalidate).toHaveBeenCalledWith('ws-1', ['courses'])
    })

    it('opens the course to everyone when every list is empty', async () => {
        const deps = build()
        const out = await run(deps)
        expect(deps.prisma.courseAudience.createMany).toHaveBeenCalledWith({
            data: [],
        })
        expect(out.summary).toBeNull()
    })
})
