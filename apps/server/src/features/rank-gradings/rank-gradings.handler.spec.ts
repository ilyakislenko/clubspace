import { ForbiddenError } from '../../shared/errors/shared.errors'
import { AddRankGradingCandidatesFeature } from './add-rank-grading-candidates.feature'
import { AddRankGradingCandidatesHandler } from './add-rank-grading-candidates.handler'
import { CreateRankGradingFeature } from './create-rank-grading.feature'
import { CreateRankGradingHandler } from './create-rank-grading.handler'
import { DeleteRankGradingFeature } from './delete-rank-grading.feature'
import { DeleteRankGradingHandler } from './delete-rank-grading.handler'
import { GetRankGradingFeature } from './get-rank-grading.feature'
import { GetRankGradingHandler } from './get-rank-grading.handler'
import { ListRankGradingsFeature } from './list-rank-gradings.feature'
import { ListRankGradingsHandler } from './list-rank-gradings.handler'
import { RemoveRankGradingCandidateFeature } from './remove-rank-grading-candidate.feature'
import { RemoveRankGradingCandidateHandler } from './remove-rank-grading-candidate.handler'
import { UpdateRankGradingCandidateFeature } from './update-rank-grading-candidate.feature'
import { UpdateRankGradingCandidateHandler } from './update-rank-grading-candidate.handler'
import { UpdateRankGradingFeature } from './update-rank-grading.feature'
import { UpdateRankGradingHandler } from './update-rank-grading.handler'

const OWNER = 'owner1'
const rbac = (admin = true) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: admin ? 'admin' : 'coach_own_only',
        workspaceOwnerId: OWNER,
    }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const realtime = () => ({ invalidate: jest.fn() }) as never

const GRADING_ROW = {
    id: 'gr1',
    ladderId: 'l1',
    ladder: { name: 'Взрослые' },
    title: 'Аттестация · Взрослые',
    date: new Date('2026-11-15T00:00:00Z'),
    gym: null,
    feeAmount: null,
    feeCurrency: null,
    candidates: [] as object[],
    createdAt: new Date('2026-10-01T00:00:00Z'),
}

const detailPrisma = (over: object = {}) => ({
    rankGrading: {
        findFirst: jest.fn().mockResolvedValue(GRADING_ROW),
        ...over,
    },
})

describe('rank gradings: authorization', () => {
    const cases: [string, (p: never, r: never) => Promise<unknown>][] = [
        ['create', (p, r) =>
            new CreateRankGradingHandler(p, r).execute(
                new CreateRankGradingFeature({ ladderId: 'l1', date: '2026-11-15' }, 'w1', 'u1', 'coach', false))],
        ['list', (p, r) =>
            new ListRankGradingsHandler(p, r).execute(
                new ListRankGradingsFeature({}, 'w1', 'u1', 'coach', false))],
        ['get', (p, r) =>
            new GetRankGradingHandler(p, r).execute(
                new GetRankGradingFeature('w1', 'gr1', 'u1', 'coach', false))],
        ['update', (p, r) =>
            new UpdateRankGradingHandler(p, r, realtime()).execute(
                new UpdateRankGradingFeature({ title: 'x' }, 'w1', 'gr1', 'u1', 'coach', false))],
        ['delete', (p, r) =>
            new DeleteRankGradingHandler(p, r, realtime()).execute(
                new DeleteRankGradingFeature('w1', 'gr1', 'u1', 'coach', false))],
        ['add candidates', (p, r) =>
            new AddRankGradingCandidatesHandler(p, r, {} as never, realtime()).execute(
                new AddRankGradingCandidatesFeature({ userIds: ['a'] }, 'w1', 'gr1', 'u1', 'coach', false))],
        ['update candidate', (p, r) =>
            new UpdateRankGradingCandidateHandler(p, r).execute(
                new UpdateRankGradingCandidateFeature({ paid: true }, 'w1', 'gr1', 'c1', 'u1', 'coach', false))],
        ['remove candidate', (p, r) =>
            new RemoveRankGradingCandidateHandler(p, r, realtime()).execute(
                new RemoveRankGradingCandidateFeature('w1', 'gr1', 'c1', 'u1', 'coach', false))],
    ]

    it.each(cases)('%s rejects coach scope before touching data', async (_n, run) => {
        const prisma = {
            rankGrading: { findFirst: jest.fn(), create: jest.fn() },
            rankLadder: { findFirst: jest.fn() },
        }
        await expect(run(prisma as never, rbac(false) as never)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.rankGrading.findFirst).not.toHaveBeenCalled()
        expect(prisma.rankGrading.create).not.toHaveBeenCalled()
    })
})

describe('createRankGrading', () => {
    const make = (ladder: object | null, feeIn?: object) => {
        const prisma = {
            rankLadder: { findFirst: jest.fn().mockResolvedValue(ladder) },
            gym: { findFirst: jest.fn().mockResolvedValue(null) },
            rankGrading: {
                create: jest.fn().mockResolvedValue({ id: 'gr1' }),
                findFirst: jest.fn().mockResolvedValue(GRADING_ROW),
            },
        }
        return { prisma, feeIn }
    }
    const run = (prisma: object, payload: object) =>
        new CreateRankGradingHandler(prisma as never, rbac() as never).execute(
            new CreateRankGradingFeature(payload as never, 'w1', 'u1', 'admin', false),
        )

    it('404s an unknown ladder', async () => {
        const { prisma } = make(null)
        await expect(run(prisma, { ladderId: 'l1', date: '2026-11-15' })).rejects.toThrow(
            /Лестница не найдена/,
        )
    })

    it('refuses an archived ladder', async () => {
        const { prisma } = make({ id: 'l1', name: 'A', isActive: false })
        await expect(run(prisma, { ladderId: 'l1', date: '2026-11-15' })).rejects.toThrow(
            /в архиве/,
        )
        expect(prisma.rankGrading.create).not.toHaveBeenCalled()
    })

    it('404s a gym outside the club', async () => {
        const { prisma } = make({ id: 'l1', name: 'A', isActive: true })
        await expect(
            run(prisma, { ladderId: 'l1', date: '2026-11-15', gymId: 'g9' }),
        ).rejects.toThrow(/Зал не найден/)
    })

    it('defaults the title, stores the date as a calendar day and no fee currency without a fee', async () => {
        const { prisma } = make({ id: 'l1', name: 'Взрослые', isActive: true })
        const out = await run(prisma, { ladderId: 'l1', date: '2026-11-15' })
        const data = prisma.rankGrading.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: 'w1',
            title: 'Аттестация · Взрослые',
            feeAmount: null,
            feeCurrency: null,
            createdById: 'u1',
        })
        expect(data.date).toEqual(new Date('2026-11-15T00:00:00Z'))
        expect(out).toMatchObject({ id: 'gr1', date: '2026-11-15' })
    })

    it('upper-cases a typed currency', async () => {
        const { prisma } = make({ id: 'l1', name: 'A', isActive: true })
        await run(prisma, { ladderId: 'l1', date: '2026-11-15', feeAmount: 10, feeCurrency: 'usd' })
        expect(prisma.rankGrading.create.mock.calls[0][0].data.feeCurrency).toBe('USD')
    })

    it('defaults the currency to RUB when a fee is set', async () => {
        const { prisma } = make({ id: 'l1', name: 'A', isActive: true })
        await run(prisma, { ladderId: 'l1', date: '2026-11-15', feeAmount: 1500 })
        expect(prisma.rankGrading.create.mock.calls[0][0].data).toMatchObject({
            feeAmount: 1500,
            feeCurrency: 'RUB',
        })
    })
})

describe('listRankGradings / getRankGrading', () => {
    it('lists newest first with counts', async () => {
        const prisma = {
            rankGrading: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        ...GRADING_ROW,
                        candidates: [
                            { result: 'PASSED', paidAt: new Date() },
                            { result: 'PENDING', paidAt: null },
                            { result: 'FAILED', paidAt: new Date() },
                        ],
                    },
                ]),
            },
        }
        const out = await new ListRankGradingsHandler(
            prisma as never,
            rbac() as never,
        ).execute(new ListRankGradingsFeature({ ladderId: 'l1' }, 'w1', 'u1', 'admin', false))
        const args = prisma.rankGrading.findMany.mock.calls[0][0]
        expect(args).toMatchObject({
            where: { workspaceId: 'w1', ladderId: 'l1' },
            orderBy: { date: 'desc' },
            take: 100,
        })
        expect(out.data[0].counts).toEqual({
            candidates: 3,
            pending: 1,
            passed: 1,
            failed: 1,
            paid: 2,
        })
    })

    it('404s a missing grading', async () => {
        const prisma = detailPrisma({ findFirst: jest.fn().mockResolvedValue(null) })
        await expect(
            new GetRankGradingHandler(prisma as never, rbac() as never).execute(
                new GetRankGradingFeature('w1', 'gr9', 'u1', 'admin', false),
            ),
        ).rejects.toThrow(/Аттестация не найдена/)
    })
})

describe('updateRankGrading', () => {
    const make = () => ({
        rankGrading: {
            findFirst: jest
                .fn()
                .mockResolvedValue({ ...GRADING_ROW, feeAmount: 1000, feeCurrency: 'USD' }),
            update: jest.fn().mockResolvedValue({}),
        },
        gym: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
    })
    const rt = { invalidate: jest.fn() } as never
    const run = (prisma: object, payload: object) =>
        new UpdateRankGradingHandler(prisma as never, rbac() as never, rt).execute(
            new UpdateRankGradingFeature(payload as never, 'w1', 'gr1', 'u1', 'admin', false),
        )

    it('writes only the sent fields and never the ladder', async () => {
        const prisma = make()
        await run(prisma, { title: 'Новое' })
        expect(prisma.rankGrading.update.mock.calls[0][0].data).toEqual({ title: 'Новое' })
    })

    it('upper-cases a typed currency and refreshes the rank screens', async () => {
        const prisma = make()
        await run(prisma, { feeCurrency: 'usd' })
        expect(prisma.rankGrading.update.mock.calls[0][0].data).toEqual({
            feeAmount: 1000,
            feeCurrency: 'USD',
        })
        expect((rt as unknown as { invalidate: jest.Mock }).invalidate).toHaveBeenCalledWith('w1', ['ranks'])
    })

    it('clears the currency with the fee', async () => {
        const prisma = make()
        await run(prisma, { feeAmount: null })
        expect(prisma.rankGrading.update.mock.calls[0][0].data).toEqual({
            feeAmount: null,
            feeCurrency: null,
        })
    })

    it('keeps the stored currency when only the amount changes', async () => {
        const prisma = make()
        await run(prisma, { feeAmount: 2000 })
        expect(prisma.rankGrading.update.mock.calls[0][0].data).toEqual({
            feeAmount: 2000,
            feeCurrency: 'USD',
        })
    })
})

describe('deleteRankGrading', () => {
    const rt = { invalidate: jest.fn() }
    const make = (passed: number, paid = 0) => ({
        rankGrading: {
            findFirst: jest.fn().mockResolvedValue({ id: 'gr1' }),
            delete: jest.fn().mockResolvedValue({}),
        },
        rankGradingCandidate: {
            count: jest
                .fn()
                .mockImplementation(({ where }) =>
                    Promise.resolve(where.paidAt ? paid : passed),
                ),
        },
    })
    const run = (prisma: object) =>
        new DeleteRankGradingHandler(prisma as never, rbac() as never, rt as never).execute(
            new DeleteRankGradingFeature('w1', 'gr1', 'u1', 'admin', false),
        )

    it('refuses when someone has passed', async () => {
        const prisma = make(1)
        await expect(run(prisma)).rejects.toThrow(/уже присвоены ранги/)
        expect(prisma.rankGrading.delete).not.toHaveBeenCalled()
    })

    it('refuses while fees are still marked paid', async () => {
        const prisma = make(0, 2)
        await expect(run(prisma)).rejects.toThrow(/снимите отметки об оплате/)
        expect(prisma.rankGrading.delete).not.toHaveBeenCalled()
    })

    it('deletes otherwise', async () => {
        const prisma = make(0)
        expect(await run(prisma)).toEqual({ status: 'deleted' })
        expect(rt.invalidate).toHaveBeenCalledWith('w1', ['ranks'])
        expect(prisma.rankGrading.delete).toHaveBeenCalledWith({ where: { id: 'gr1' } })
    })
})

describe('addRankGradingCandidates', () => {
    const LEVELS = [
        { id: 'white', name: 'Белый', order: 0, isActive: true },
        { id: 'blue', name: 'Синий', order: 1, isActive: true },
    ]
    const make = (
        o: {
            active?: string[]
            latest?: object[]
            existing?: string[]
            elsewhere?: string[]
            levels?: object[]
        } = {},
    ) => {
        const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
        const rt = { invalidate: jest.fn() }
        const prisma = {
            rankGrading: {
                findFirst: jest.fn().mockImplementation(({ include }) =>
                    Promise.resolve(
                        include
                            ? GRADING_ROW
                            : {
                                  id: 'gr1',
                                  ladderId: 'l1',
                                  date: new Date('2026-11-15T00:00:00Z'),
                                  ladder: { name: 'Взрослые' },
                                  workspace: { timezone: 'Europe/Moscow' },
                              },
                    ),
                ),
            },
            workspaceMember: {
                findMany: jest
                    .fn()
                    .mockResolvedValue((o.active ?? ['a']).map((userId) => ({ userId }))),
            },
            rankLevel: { findMany: jest.fn().mockResolvedValue(o.levels ?? LEVELS) },
            rankGradingCandidate: {
                findMany: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve(
                        (where.gradingId?.not ? (o.elsewhere ?? []) : (o.existing ?? [])).map(
                            (userId) => ({ userId }),
                        ),
                    ),
                ),
                createMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            rankPromotion: { findMany: jest.fn().mockResolvedValue(o.latest ?? []) },
            user: {
                findMany: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve(
                        where.id.in.map((id: string) => ({
                            id,
                            firstname: id,
                            lastname: null,
                        })),
                    ),
                ),
            },
        }
        const run = (payload: object) =>
            new AddRankGradingCandidatesHandler(
                prisma as never,
                rbac() as never,
                notifications as never,
                rt as never,
            ).execute(
                new AddRankGradingCandidatesFeature(payload as never, 'w1', 'gr1', 'u1', 'admin', false),
            )
        return { prisma, notifications, rt, run }
    }

    it('refuses the whole batch when someone is not an active member', async () => {
        const { prisma, run } = make({ active: ['a'] })
        await expect(run({ userIds: ['a', 'b'] })).rejects.toThrow(/неактивна/)
        expect(prisma.rankGradingCandidate.createMany).not.toHaveBeenCalled()
    })

    it('lets the owner in without a member row', async () => {
        const { prisma, run } = make({
            active: [],
            latest: [{ userId: OWNER, levelId: 'white', stripes: 0 }],
        })
        await run({ userIds: [OWNER] })
        expect(prisma.rankGradingCandidate.createMany).toHaveBeenCalled()
    })

    it('404s a level outside the ladder', async () => {
        const { run } = make()
        await expect(run({ userIds: ['a'], levelId: 'zzz' })).rejects.toThrow(
            /Уровень не найден в этой лестнице/,
        )
    })

    it('refuses an unranked member without an explicit level, naming them', async () => {
        const { prisma, run } = make({ latest: [] })
        await expect(run({ userIds: ['a'] })).rejects.toThrow(
            /Нет ранга на этой лестнице: a — выберите уровень вручную/,
        )
        expect(prisma.rankGradingCandidate.createMany).not.toHaveBeenCalled()
    })

    it('accepts an unranked member with an explicit level', async () => {
        const { prisma, run } = make({ latest: [] })
        await run({ userIds: ['a'], levelId: 'white' })
        expect(prisma.rankGradingCandidate.createMany.mock.calls[0][0].data).toEqual([
            expect.objectContaining({ userId: 'a', levelId: 'white', fromLevelName: null }),
        ])
    })

    it('refuses a member already at the top, truncating the name list', async () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        const { run } = make({
            active: ids,
            latest: ids.map((userId) => ({ userId, levelId: 'blue', stripes: 0 })),
        })
        await expect(run({ userIds: ids })).rejects.toThrow(
            /Уже на высшем уровне: a, b, c, d, e и ещё 2/,
        )
    })

    it('targets the next level, snapshots where they stood and skips duplicates', async () => {
        const { prisma, run } = make({
            latest: [{ userId: 'a', levelId: 'white', stripes: 3 }],
        })
        await run({ userIds: ['a'] })
        const args = prisma.rankGradingCandidate.createMany.mock.calls[0][0]
        expect(args.skipDuplicates).toBe(true)
        expect(args.data).toEqual([
            {
                gradingId: 'gr1',
                workspaceId: 'w1',
                userId: 'a',
                levelId: 'blue',
                stripes: 0,
                fromLevelName: 'Белый',
                fromStripes: 3,
            },
        ])
    })

    it('notifies only newly added candidates and survives a failed push', async () => {
        const { notifications, prisma, run } = make({
            active: ['a', 'b'],
            existing: ['a'],
            latest: [{ userId: 'b', levelId: 'white', stripes: 0 }],
        })
        notifications.notifyUser.mockRejectedValue(new Error('push down'))
        await run({ userIds: ['a', 'b'] })
        expect(prisma.rankGradingCandidate.createMany.mock.calls[0][0].data).toHaveLength(1)
        expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'b',
            kind: 'grading.candidate',
            refId: 'gr1:b',
            category: 'promotionsEnabled',
            feature: 'ranks',
        })
    })

    it('refuses someone already open on another upcoming grading of the ladder', async () => {
        const { prisma, run } = make({
            latest: [{ userId: 'a', levelId: 'white', stripes: 0 }],
            elsewhere: ['a'],
        })
        await expect(run({ userIds: ['a'] })).rejects.toThrow(
            /Уже в списке другой аттестации: a/,
        )
        const where = prisma.rankGradingCandidate.findMany.mock.calls[1][0].where
        expect(where).toMatchObject({
            result: 'PENDING',
            gradingId: { not: 'gr1' },
            grading: { ladderId: 'l1' },
        })
        expect(prisma.rankGradingCandidate.createMany).not.toHaveBeenCalled()
    })

    it('refuses an archived explicit level', async () => {
        const { run } = make({
            levels: [
                { id: 'white', name: 'Белый', order: 0, isActive: true },
                { id: 'blue', name: 'Синий', order: 1, isActive: false },
            ],
        })
        await expect(run({ userIds: ['a'], levelId: 'blue' })).rejects.toThrow(/в архиве/)
    })

    it('refuses an explicit level that is not above the current one', async () => {
        const { prisma, run } = make({
            latest: [{ userId: 'a', levelId: 'blue', stripes: 0 }],
        })
        await expect(run({ userIds: ['a'], levelId: 'white' })).rejects.toThrow(
            /Уже на этом уровне или выше: a/,
        )
        expect(prisma.rankGradingCandidate.createMany).not.toHaveBeenCalled()
    })

    it('refreshes the rank screens after adding', async () => {
        const { rt, run } = make({
            latest: [{ userId: 'a', levelId: 'white', stripes: 0 }],
        })
        await run({ userIds: ['a'] })
        expect(rt.invalidate).toHaveBeenCalledWith('w1', ['ranks'])
    })

    it('is idempotent when everyone is already listed', async () => {
        const { prisma, notifications, run } = make({ existing: ['a'] })
        await run({ userIds: ['a'] })
        expect(prisma.rankGradingCandidate.createMany).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })
})

describe('updateRankGradingCandidate', () => {
    const CAND = {
        id: 'c1',
        userId: 'm1',
        result: 'PENDING',
        levelId: 'blue',
        stripes: 0,
        paidAt: null as Date | null,
        grading: { ladderId: 'l1' },
    }
    const make = (
        cand: object | null = CAND,
        level: object | null = { id: 'blue', maxStripes: 4, order: 1, isActive: true },
        current: object | null = { level: { order: 0 } },
    ) => ({
        rankGradingCandidate: {
            findFirst: jest.fn().mockResolvedValue(cand),
            update: jest.fn().mockResolvedValue({}),
        },
        rankLevel: { findFirst: jest.fn().mockResolvedValue(level) },
        rankPromotion: { findFirst: jest.fn().mockResolvedValue(current) },
        rankGrading: { findFirst: jest.fn().mockResolvedValue(GRADING_ROW) },
    })
    const run = (prisma: object, payload: object) =>
        new UpdateRankGradingCandidateHandler(prisma as never, rbac() as never).execute(
            new UpdateRankGradingCandidateFeature(payload as never, 'w1', 'gr1', 'c1', 'u1', 'admin', false),
        )

    it('404s a candidate from another grading', async () => {
        await expect(run(make(null), { paid: true })).rejects.toThrow(/Кандидат не найден/)
    })

    it('marks paid, keeping an earlier paidAt, and unmarks with null', async () => {
        const first = new Date('2026-10-01T00:00:00Z')
        const prisma = make({ ...CAND, paidAt: first })
        await run(prisma, { paid: true })
        expect(prisma.rankGradingCandidate.update.mock.calls[0][0].data).toEqual({ paidAt: first })
        await run(prisma, { paid: false })
        expect(prisma.rankGradingCandidate.update.mock.calls[1][0].data).toEqual({ paidAt: null })
        const fresh = make()
        await run(fresh, { paid: true })
        expect(fresh.rankGradingCandidate.update.mock.calls[0][0].data.paidAt).toBeInstanceOf(Date)
    })

    it('still allows toggling paid after PASSED', async () => {
        const prisma = make({ ...CAND, result: 'PASSED' })
        await run(prisma, { paid: true })
        expect(prisma.rankGradingCandidate.update).toHaveBeenCalled()
    })

    it('refuses a level or stripes change after PASSED', async () => {
        const prisma = make({ ...CAND, result: 'PASSED' })
        await expect(run(prisma, { stripes: 1 })).rejects.toThrow(/уровень изменить нельзя/)
        await expect(run(prisma, { levelId: 'x' })).rejects.toThrow(/уровень изменить нельзя/)
        expect(prisma.rankGradingCandidate.update).not.toHaveBeenCalled()
    })

    it('404s a level outside the ladder', async () => {
        await expect(run(make(CAND, null), { levelId: 'x' })).rejects.toThrow(
            /Уровень не найден в этой лестнице/,
        )
    })

    it('refuses switching to an archived level', async () => {
        const prisma = make(CAND, { id: 'purple', maxStripes: 4, order: 2, isActive: false })
        await expect(run(prisma, { levelId: 'purple' })).rejects.toThrow(/в архиве/)
    })

    it('refuses switching to a level not above the current rank', async () => {
        const prisma = make(
            CAND,
            { id: 'white', maxStripes: 4, order: 0, isActive: true },
            { level: { order: 0 } },
        )
        await expect(run(prisma, { levelId: 'white' })).rejects.toThrow(/выше текущего ранга/)
        expect(prisma.rankGradingCandidate.update).not.toHaveBeenCalled()
    })

    it('caps stripes at the level maximum', async () => {
        const prisma = make(CAND, { id: 'blue', maxStripes: 2, order: 1, isActive: true })
        await expect(run(prisma, { stripes: 3 })).rejects.toThrow(/от 0 до 2/)
        await run(prisma, { stripes: 2 })
        expect(prisma.rankGradingCandidate.update.mock.calls[0][0].data).toEqual({
            levelId: 'blue',
            stripes: 2,
        })
    })
})

describe('removeRankGradingCandidate', () => {
    const rt = { invalidate: jest.fn() }
    const make = (result: string | null, paidAt: Date | null = null) => ({
        rankGradingCandidate: {
            findFirst: jest
                .fn()
                .mockResolvedValue(result ? { id: 'c1', result, paidAt } : null),
            delete: jest.fn().mockResolvedValue({}),
        },
    })
    const run = (prisma: object) =>
        new RemoveRankGradingCandidateHandler(prisma as never, rbac() as never, rt as never).execute(
            new RemoveRankGradingCandidateFeature('w1', 'gr1', 'c1', 'u1', 'admin', false),
        )

    it('refuses to remove a PASSED candidate', async () => {
        const prisma = make('PASSED')
        await expect(run(prisma)).rejects.toThrow(/Нельзя убрать кандидата/)
        expect(prisma.rankGradingCandidate.delete).not.toHaveBeenCalled()
    })

    it('404s an unknown candidate', async () => {
        await expect(run(make(null))).rejects.toThrow(/Кандидат не найден/)
    })

    it('refuses while the fee is marked paid', async () => {
        const prisma = make('PENDING', new Date())
        await expect(run(prisma)).rejects.toThrow(/снимите отметки об оплате/)
        expect(prisma.rankGradingCandidate.delete).not.toHaveBeenCalled()
    })

    it('removes a pending candidate', async () => {
        const prisma = make('PENDING')
        expect(await run(prisma)).toEqual({ status: 'deleted' })
        expect(rt.invalidate).toHaveBeenCalledWith('w1', ['ranks'])
        expect(prisma.rankGradingCandidate.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    })
})
