jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddMyStudyPlanItemFeature } from './add-my-study-plan-item.feature'
import { AddMyStudyPlanItemHandler } from './add-my-study-plan-item.handler'
import { CreateMyStudyPlanFeature } from './create-my-study-plan.feature'
import { CreateMyStudyPlanHandler } from './create-my-study-plan.handler'
import { DeleteMyStudyPlanItemFeature } from './delete-my-study-plan-item.feature'
import { DeleteMyStudyPlanItemHandler } from './delete-my-study-plan-item.handler'
import { DeleteMyStudyPlanFeature } from './delete-my-study-plan.feature'
import { DeleteMyStudyPlanHandler } from './delete-my-study-plan.handler'
import { GetMyStudyPlanFeature } from './get-my-study-plan.feature'
import { GetMyStudyPlanHandler } from './get-my-study-plan.handler'
import { ListMyStudyPlansFeature } from './list-my-study-plans.feature'
import { ListMyStudyPlansHandler } from './list-my-study-plans.handler'
import { ReorderMyStudyPlanItemsFeature } from './reorder-my-study-plan-items.feature'
import { ReorderMyStudyPlanItemsHandler } from './reorder-my-study-plan-items.handler'
import { MAX_STUDY_PLAN_ITEMS } from './study-plans-utils'
import { UpdateMyStudyPlanItemFeature } from './update-my-study-plan-item.feature'
import { UpdateMyStudyPlanItemHandler } from './update-my-study-plan-item.handler'
import { UpdateMyStudyPlanFeature } from './update-my-study-plan.feature'
import { UpdateMyStudyPlanHandler } from './update-my-study-plan.handler'

const day = (n: number) => new Date(`2026-02-${String(n).padStart(2, '0')}T00:00:00Z`)

type Plan = {
    id: string
    userId: string
    workspaceId: string
    title: string
    description: string | null
    createdAt: Date
    updatedAt: Date
}
type Item = {
    id: string
    planId: string
    position: number
    videoId: string
    startSec: number
    endSec: number | null
    title: string
    note: string | null
    createdAt: Date
}
type Video = {
    id: string
    workspaceId: string
    title: string
    thumbnailUrl: string | null
    duration: number | null
}

const plan = (id: string, over: Partial<Plan> = {}): Plan => ({
    id,
    userId: 'u1',
    workspaceId: 'w1',
    title: `Plan ${id}`,
    description: null,
    createdAt: day(1),
    updatedAt: day(1),
    ...over,
})

const item = (id: string, over: Partial<Item> = {}): Item => ({
    id,
    planId: 'p1',
    position: 0,
    videoId: 'v1',
    startSec: 10,
    endSec: null,
    title: `Item ${id}`,
    note: null,
    createdAt: day(1),
    ...over,
})

const video = (id: string, workspaceId = 'w1'): Video => ({
    id,
    workspaceId,
    title: `Video ${id}`,
    thumbnailUrl: `https://cdn/${id}.jpg`,
    duration: 300,
})

const byPosition = (a: Item, b: Item) =>
    a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime()

// An in-memory Prisma for the calls these handlers make, so the specs check
// what ends up stored and returned rather than the literal queries.
const build = (
    o: {
        plans?: Plan[]
        items?: Item[]
        videos?: Video[]
        watchable?: string[]
        membership?: unknown
        ownerId?: string | null
        watchError?: Error
    } = {},
) => {
    const plans = o.plans ?? [plan('p1')]
    const items = o.items ?? []
    const videos = o.videos ?? [video('v1'), video('v2'), video('v3'), video('x1', 'w2')]
    const withVideo = (i: Item) => ({ ...i, video: videos.find((v) => v.id === i.videoId)! })
    let seq = 0
    const db = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: o.ownerId ?? null }),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    o.membership === undefined
                        ? { status: 'ACTIVE', accessUntil: null }
                        : o.membership,
                ),
        },
        studyPlan: {
            findUnique: jest.fn(
                async ({ where }: { where: { id: string } }) =>
                    plans.find((p) => p.id === where.id) ?? null,
            ),
            findMany: jest.fn(
                async ({ where }: { where: { userId: string; workspaceId: string } }) =>
                    plans
                        .filter(
                            (p) =>
                                p.userId === where.userId &&
                                p.workspaceId === where.workspaceId,
                        )
                        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                        .map((p) => {
                            const own = items.filter((i) => i.planId === p.id).sort(byPosition)
                            return {
                                ...p,
                                _count: { items: own.length },
                                items: own.slice(0, 1).map((i) => {
                                    const v = withVideo(i).video
                                    return { video: { id: v.id, thumbnailUrl: v.thumbnailUrl } }
                                }),
                            }
                        }),
            ),
            create: jest.fn(async ({ data }: { data: Partial<Plan> }) => {
                const row = { ...plan('new'), ...data, createdAt: day(9), updatedAt: day(9) }
                plans.push(row)
                return row
            }),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: Partial<Plan> }) => {
                    const row = plans.find((p) => p.id === where.id)!
                    Object.assign(row, data)
                    return row
                },
            ),
            delete: jest.fn(async ({ where }: { where: { id: string } }) => {
                plans.splice(plans.findIndex((p) => p.id === where.id), 1)
            }),
        },
        studyPlanItem: {
            findMany: jest.fn(async ({ where }: { where: { planId: string } }) =>
                items.filter((i) => i.planId === where.planId).sort(byPosition).map(withVideo),
            ),
            findUnique: jest.fn(
                async ({ where }: { where: { id: string } }) =>
                    items.find((i) => i.id === where.id) ?? null,
            ),
            count: jest.fn(
                async ({ where }: { where: { planId: string } }) =>
                    items.filter((i) => i.planId === where.planId).length,
            ),
            findFirst: jest.fn(async ({ where }: { where: { planId: string } }) => {
                const own = items.filter((i) => i.planId === where.planId).sort(byPosition)
                return own.length > 0 ? { position: own[own.length - 1].position } : null
            }),
            create: jest.fn(async ({ data }: { data: Omit<Item, 'id' | 'createdAt'> }) => {
                const row = { id: `new-${++seq}`, createdAt: day(9), ...data }
                items.push(row)
                return row
            }),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => {
                    const row = items.find((i) => i.id === where.id)!
                    Object.assign(row, data)
                    return row
                },
            ),
            deleteMany: jest.fn(
                async ({ where }: { where: { id: string; planId: string } }) => {
                    const at = items.findIndex(
                        (i) => i.id === where.id && i.planId === where.planId,
                    )
                    if (at === -1) return { count: 0 }
                    items.splice(at, 1)
                    return { count: 1 }
                },
            ),
        },
        video: {
            findUnique: jest.fn(
                async ({ where }: { where: { id: string } }) =>
                    videos.find((v) => v.id === where.id) ?? null,
            ),
        },
    }
    // Plan row locks (SELECT … FOR UPDATE): a transaction asking for a held
    // lock waits until the holder's transaction ends, like Postgres.
    const held = new Map<string, Promise<void>>()
    const prisma = {
        ...db,
        $transaction: jest.fn(async (arg: unknown) => {
            if (Array.isArray(arg)) return Promise.all(arg)
            const releases: Array<() => void> = []
            const tx = {
                ...db,
                $queryRaw: jest.fn(async (_sql: TemplateStringsArray, planId: string) => {
                    while (held.has(planId)) await held.get(planId)
                    held.set(
                        planId,
                        new Promise<void>((resolve) =>
                            releases.push(() => {
                                held.delete(planId)
                                resolve()
                            }),
                        ),
                    )
                    return plans.filter((p) => p.id === planId).map((p) => ({ id: p.id }))
                }),
            }
            try {
                return await (arg as (t: typeof tx) => Promise<unknown>)(tx)
            } finally {
                for (const release of releases) release()
            }
        }),
    }
    const courseAccess = {
        watchableVideoIds: jest.fn(
            async (_ws: string, _user: string, ids: readonly string[]) =>
                new Set(ids.filter((id) => (o.watchable ?? ['v1', 'v2', 'v3']).includes(id))),
        ),
        assertCanWatchVideo: jest.fn(async () => {
            if (o.watchError) throw o.watchError
            return { isStaff: false, visibleCourseIds: [] }
        }),
    }
    return { prisma, courseAccess, plans, items }
}

type Deps = ReturnType<typeof build>
const p = (deps: Deps) => deps.prisma as never
const c = (deps: Deps) => deps.courseAccess as never

const list = (deps: Deps) =>
    new ListMyStudyPlansHandler(p(deps), c(deps)).execute(
        new ListMyStudyPlansFeature('u1', 'w1'),
    )
const get = (deps: Deps, planId = 'p1') =>
    new GetMyStudyPlanHandler(p(deps), c(deps)).execute(
        new GetMyStudyPlanFeature('u1', 'w1', planId),
    )
const add = (deps: Deps, payload: Record<string, unknown> = {}, planId = 'p1') =>
    new AddMyStudyPlanItemHandler(p(deps), c(deps)).execute(
        new AddMyStudyPlanItemFeature('u1', 'w1', planId, {
            videoId: 'v2',
            startSec: 30,
            endSec: 45,
            title: 'Sweep',
            note: null,
            ...payload,
        } as never),
    )
const updateItem = (deps: Deps, itemId: string, payload: Record<string, unknown>) =>
    new UpdateMyStudyPlanItemHandler(p(deps), c(deps)).execute(
        new UpdateMyStudyPlanItemFeature('u1', 'w1', 'p1', itemId, payload as never),
    )
const deleteItem = (deps: Deps, itemId: string) =>
    new DeleteMyStudyPlanItemHandler(p(deps), c(deps)).execute(
        new DeleteMyStudyPlanItemFeature('u1', 'w1', 'p1', itemId),
    )
const reorder = (deps: Deps, itemIds: string[]) =>
    new ReorderMyStudyPlanItemsHandler(p(deps), c(deps)).execute(
        new ReorderMyStudyPlanItemsFeature('u1', 'w1', 'p1', { itemIds }),
    )

// Every route that addresses one plan.
const PLAN_ROUTES: [string, (deps: Deps, planId: string) => Promise<unknown>][] = [
    ['get', (deps, planId) => get(deps, planId)],
    [
        'rename',
        (deps, planId) =>
            new UpdateMyStudyPlanHandler(p(deps), c(deps)).execute(
                new UpdateMyStudyPlanFeature('u1', 'w1', planId, { title: 'x' }),
            ),
    ],
    [
        'delete',
        (deps, planId) =>
            new DeleteMyStudyPlanHandler(p(deps)).execute(
                new DeleteMyStudyPlanFeature('u1', 'w1', planId),
            ),
    ],
    ['add item', (deps, planId) => add(deps, {}, planId)],
    [
        'update item',
        (deps, planId) =>
            new UpdateMyStudyPlanItemHandler(p(deps), c(deps)).execute(
                new UpdateMyStudyPlanItemFeature('u1', 'w1', planId, 'i1', { title: 'x' }),
            ),
    ],
    [
        'delete item',
        (deps, planId) =>
            new DeleteMyStudyPlanItemHandler(p(deps), c(deps)).execute(
                new DeleteMyStudyPlanItemFeature('u1', 'w1', planId, 'i1'),
            ),
    ],
    [
        'reorder',
        (deps, planId) =>
            new ReorderMyStudyPlanItemsHandler(p(deps), c(deps)).execute(
                new ReorderMyStudyPlanItemsFeature('u1', 'w1', planId, { itemIds: ['i1'] }),
            ),
    ],
]

describe('study plan access', () => {
    it.each(PLAN_ROUTES)("%s refuses a user who isn't an active member", async (_, run) => {
        const deps = build({ membership: null, items: [item('i1')] })
        await expect(run(deps, 'p1')).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.studyPlan.findUnique).not.toHaveBeenCalled()
    })

    it.each(PLAN_ROUTES)("%s 404s someone else's plan", async (_, run) => {
        const deps = build({ plans: [plan('p1', { userId: 'u2' })], items: [item('i1')] })
        await expect(run(deps, 'p1')).rejects.toBeInstanceOf(NotFoundError)
        expect(deps.prisma.studyPlanItem.create).not.toHaveBeenCalled()
        expect(deps.prisma.studyPlan.delete).not.toHaveBeenCalled()
    })

    it.each(PLAN_ROUTES)("%s 404s a plan of another club", async (_, run) => {
        const deps = build({ plans: [plan('p1', { workspaceId: 'w2' })], items: [item('i1')] })
        await expect(run(deps, 'p1')).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each(PLAN_ROUTES)('%s 404s a missing plan', async (_, run) => {
        await expect(run(build(), 'nope')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('lets the owner (no member row) use their plans', async () => {
        const deps = build({ membership: null, ownerId: 'u1' })
        await expect(get(deps)).resolves.toMatchObject({ id: 'p1' })
    })

    it('refuses the list and create to a non-member', async () => {
        const deps = build({ membership: null })
        await expect(list(deps)).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            new CreateMyStudyPlanHandler(p(deps)).execute(
                new CreateMyStudyPlanFeature('u1', 'w1', { title: 'x', description: null }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.studyPlan.create).not.toHaveBeenCalled()
    })
})

describe('ListMyStudyPlansHandler', () => {
    it('lists own plans in this club, latest activity first, with counts and covers', async () => {
        const deps = build({
            plans: [
                plan('p1', { updatedAt: day(2) }),
                plan('p2', { updatedAt: day(5) }),
                plan('p3', { updatedAt: day(3) }),
                plan('other', { userId: 'u2' }),
                plan('away', { workspaceId: 'w2' }),
            ],
            items: [
                item('a', { planId: 'p1', position: 1, videoId: 'v2' }),
                item('b', { planId: 'p1', position: 0, videoId: 'v1' }),
                // The first lesson of p3 is locked for this member.
                item('c', { planId: 'p3', videoId: 'v3' }),
            ],
            watchable: ['v1', 'v2'],
        })
        const res = await list(deps)
        expect(res.items.map((i) => [i.id, i.itemCount, i.coverUrl])).toEqual([
            ['p2', 0, null],
            ['p3', 1, null],
            ['p1', 2, 'https://cdn/v1.jpg'],
        ])
    })
})

describe('CreateMyStudyPlanHandler', () => {
    it('creates an empty plan for the member in this club', async () => {
        const deps = build({ plans: [] })
        const res = await new CreateMyStudyPlanHandler(p(deps)).execute(
            new CreateMyStudyPlanFeature('u1', 'w1', { title: 'Guard', description: '' }),
        )
        expect(deps.prisma.studyPlan.create.mock.calls[0][0].data).toEqual({
            userId: 'u1',
            workspaceId: 'w1',
            title: 'Guard',
            description: null,
        })
        expect(res).toMatchObject({ title: 'Guard', description: null, items: [] })
    })
})

describe('GetMyStudyPlanHandler', () => {
    it('returns items in play order; a locked lesson is flagged with no details', async () => {
        const deps = build({
            items: [
                item('late', { position: 2, videoId: 'v3', note: 'n' }),
                item('first', { position: 0, endSec: 40 }),
                item('mid', { position: 1, videoId: 'v2' }),
            ],
            watchable: ['v1', 'v2'],
        })
        const res = await get(deps)
        expect(res.items.map((i) => i.id)).toEqual(['first', 'mid', 'late'])
        expect(res.items[0]).toEqual({
            id: 'first',
            position: 0,
            videoId: 'v1',
            startSec: 10,
            endSec: 40,
            title: 'Item first',
            note: null,
            createdAt: day(1).toISOString(),
            accessible: true,
            video: {
                id: 'v1',
                title: 'Video v1',
                thumbnailUrl: 'https://cdn/v1.jpg',
                duration: 300,
            },
        })
        expect(res.items[2]).toMatchObject({
            videoId: 'v3',
            title: 'Item late',
            note: 'n',
            accessible: false,
            video: null,
        })
        expect(deps.courseAccess.watchableVideoIds).toHaveBeenCalledWith('w1', 'u1', [
            'v1',
            'v2',
            'v3',
        ])
    })
})

describe('UpdateMyStudyPlanHandler', () => {
    it('renames and clears the description; untouched fields stay', async () => {
        const deps = build({ plans: [plan('p1', { description: 'old' })] })
        const res = await new UpdateMyStudyPlanHandler(p(deps), c(deps)).execute(
            new UpdateMyStudyPlanFeature('u1', 'w1', 'p1', { title: 'New' }),
        )
        expect(res).toMatchObject({ title: 'New', description: 'old' })
        const cleared = await new UpdateMyStudyPlanHandler(p(deps), c(deps)).execute(
            new UpdateMyStudyPlanFeature('u1', 'w1', 'p1', { description: '' }),
        )
        expect(cleared).toMatchObject({ title: 'New', description: null })
    })
})

describe('DeleteMyStudyPlanHandler', () => {
    it('deletes the plan', async () => {
        const deps = build()
        await expect(
            new DeleteMyStudyPlanHandler(p(deps)).execute(
                new DeleteMyStudyPlanFeature('u1', 'w1', 'p1'),
            ),
        ).resolves.toEqual({ status: 'deleted' })
        expect(deps.plans).toEqual([])
    })
})

describe('AddMyStudyPlanItemHandler', () => {
    it('appends the moment after the last item and bumps the plan', async () => {
        const deps = build({ items: [item('i1', { position: 4 })] })
        const res = await add(deps)
        expect(deps.items[1]).toMatchObject({
            planId: 'p1',
            position: 5,
            videoId: 'v2',
            startSec: 30,
            endSec: 45,
            title: 'Sweep',
            note: null,
        })
        expect(res.items.map((i) => i.videoId)).toEqual(['v1', 'v2'])
        expect(deps.plans[0].updatedAt).not.toEqual(day(1))
        expect(deps.courseAccess.assertCanWatchVideo).toHaveBeenCalledWith(
            { ...video('v2') },
            'u1',
        )
    })

    it('starts an empty plan at position 0', async () => {
        const deps = build()
        await add(deps, { endSec: null, note: '' })
        expect(deps.items[0]).toMatchObject({ position: 0, endSec: null, note: null })
    })

    it.each([45, 20])('rejects an end (%i) not after the start (45)', async (endSec) => {
        const deps = build()
        await expect(add(deps, { startSec: 45, endSec })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(deps.prisma.studyPlanItem.create).not.toHaveBeenCalled()
    })

    it.each([
        ['an unknown video', 'zz'],
        ["another club's video", 'x1'],
    ])('404s %s', async (_, videoId) => {
        const deps = build()
        await expect(add(deps, { videoId })).rejects.toBeInstanceOf(NotFoundError)
        expect(deps.courseAccess.assertCanWatchVideo).not.toHaveBeenCalled()
        expect(deps.prisma.studyPlanItem.create).not.toHaveBeenCalled()
    })

    it('refuses a lesson the member may not watch', async () => {
        const deps = build({ watchError: new ForbiddenError({ message: 'locked' }) })
        await expect(add(deps)).rejects.toBeInstanceOf(ForbiddenError)
        expect(deps.prisma.studyPlanItem.create).not.toHaveBeenCalled()
    })

    it('refuses past the item limit', async () => {
        const full = Array.from({ length: MAX_STUDY_PLAN_ITEMS }, (_, i) =>
            item(`i${i}`, { position: i }),
        )
        const deps = build({ items: full })
        await expect(add(deps)).rejects.toBeInstanceOf(BadRequestError)
        expect(deps.prisma.studyPlanItem.create).not.toHaveBeenCalled()
    })

    it('counts and positions under the plan lock, so concurrent adds stop at the limit', async () => {
        const almostFull = Array.from({ length: MAX_STUDY_PLAN_ITEMS - 1 }, (_, i) =>
            item(`i${i}`, { position: i }),
        )
        const deps = build({ items: almostFull })
        const results = await Promise.allSettled([add(deps), add(deps)])
        expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
        expect(
            results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!.reason,
        ).toBeInstanceOf(BadRequestError)
        expect(deps.items).toHaveLength(MAX_STUDY_PLAN_ITEMS)
        expect(deps.prisma.$transaction).toHaveBeenCalledTimes(2)
    })

    it('gives concurrent adds distinct positions', async () => {
        const deps = build()
        await Promise.all([add(deps), add(deps), add(deps)])
        expect(deps.items.map((i) => i.position)).toEqual([0, 1, 2])
    })

    it('404s a plan deleted before its lock was taken', async () => {
        const deps = build()
        deps.prisma.studyPlan.findUnique.mockResolvedValueOnce(plan('p1'))
        deps.plans.splice(0, 1)
        await expect(add(deps)).rejects.toBeInstanceOf(NotFoundError)
        expect(deps.prisma.studyPlanItem.create).not.toHaveBeenCalled()
    })
})

describe('UpdateMyStudyPlanItemHandler', () => {
    it('changes only the fields sent', async () => {
        const deps = build({ items: [item('i1', { endSec: 40, note: 'keep' })] })
        const res = await updateItem(deps, 'i1', { title: 'Hip escape' })
        expect(res.items[0]).toMatchObject({
            title: 'Hip escape',
            startSec: 10,
            endSec: 40,
            note: 'keep',
        })
    })

    it('turns a segment into a moment and clears the note', async () => {
        const deps = build({ items: [item('i1', { endSec: 40, note: 'x' })] })
        const res = await updateItem(deps, 'i1', { endSec: null, note: '' })
        expect(res.items[0]).toMatchObject({ endSec: null, note: null })
    })

    it('checks the range after merging with the stored one', async () => {
        const deps = build({ items: [item('i1', { startSec: 10, endSec: 40 })] })
        await expect(updateItem(deps, 'i1', { startSec: 50 })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(deps.prisma.studyPlanItem.update).not.toHaveBeenCalled()
    })

    it.each([
        ['missing', []],
        ["another plan's", [item('i1', { planId: 'p2' })]],
    ])('404s a %s item', async (_, items) => {
        const deps = build({ plans: [plan('p1'), plan('p2')], items })
        await expect(updateItem(deps, 'i1', { title: 'x' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})

describe('DeleteMyStudyPlanItemHandler', () => {
    it('removes the item and returns the rest', async () => {
        const deps = build({ items: [item('i1'), item('i2', { position: 1 })] })
        const res = await deleteItem(deps, 'i1')
        expect(res.items.map((i) => i.id)).toEqual(['i2'])
    })

    it("404s an item of another plan", async () => {
        const deps = build({ plans: [plan('p1'), plan('p2')], items: [item('i1', { planId: 'p2' })] })
        await expect(deleteItem(deps, 'i1')).rejects.toBeInstanceOf(NotFoundError)
        expect(deps.items).toHaveLength(1)
    })
})

describe('ReorderMyStudyPlanItemsHandler', () => {
    const three = () => [
        item('a', { position: 0 }),
        item('b', { position: 1 }),
        item('c', { position: 2 }),
    ]

    it('stores the new play order', async () => {
        const deps = build({ items: three() })
        const res = await reorder(deps, ['c', 'a', 'b'])
        expect(res.items.map((i) => [i.id, i.position])).toEqual([
            ['c', 0],
            ['a', 1],
            ['b', 2],
        ])
        expect(deps.prisma.$transaction).toHaveBeenCalled()
    })

    it.each([
        ['misses an item', ['c', 'a']],
        ['repeats an item', ['a', 'a', 'b']],
        ['has a foreign id', ['a', 'b', 'z']],
    ])('refuses a list that %s', async (_, ids) => {
        const deps = build({ items: three() })
        await expect(reorder(deps, ids)).rejects.toBeInstanceOf(BadRequestError)
        expect(deps.prisma.studyPlanItem.update).not.toHaveBeenCalled()
    })
})
