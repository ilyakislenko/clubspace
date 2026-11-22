import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { ListOpenRequestsFeature } from './list-open-requests.feature'
import { ListOpenRequestsHandler } from './list-open-requests.handler'

const OWNER = 'owner'
const T = (iso: string) => new Date(iso)

const guardian = {
    relation: 'PARENT',
    consentAt: T('2026-10-01T00:00:00Z'),
    guardian: {
        id: 'g1',
        firstname: 'Ольга',
        lastname: 'Петрова',
        email: 'olga@b.com',
        phone: '+79990000000',
    },
}
const person = (id: string, firstname: string, email: string | null, dependentOf: unknown[] = []) => ({
    id,
    firstname,
    lastname: 'Петрова',
    email,
    dependentOf,
})

const JOIN = {
    id: 'm1',
    userId: 'u-join',
    workspaceId: 'w1',
    status: 'INVITED',
    createdAt: T('2026-11-10T09:00:00Z'),
    user: person('u-join', 'Анна', 'anna@b.com'),
    role: { name: 'user' },
}
const FREEZE = {
    id: 'f1',
    workspaceId: 'w1',
    subscriptionId: 's1',
    userId: 'u-kid',
    status: 'PENDING',
    fromDate: T('2026-11-18T00:00:00Z'),
    days: 10,
    reason: 'Болезнь',
    createdAt: T('2026-11-11T09:00:00Z'),
    user: person('u-kid', 'Маша', null, [guardian]),
    subscription: { endDate: T('2026-12-20T00:00:00Z'), plan: { name: '12 занятий' } },
}
const PERSONAL = {
    id: 'p1',
    workspaceId: 'w1',
    memberId: 'u-pt',
    coachId: 'coach',
    timezone: 'Asia/Tomsk',
    status: 'PENDING_COACH',
    memberComment: 'Хочу поработать над техникой',
    createdAt: T('2026-11-12T09:00:00Z'),
    member: person('u-pt', 'Игорь', 'igor@b.com'),
    coach: { id: 'coach', firstname: 'Пётр', lastname: 'Иванов', email: 'coach@b.com' },
    gym: { name: 'Зал на Ленина' },
    options: [{ id: 'o2', startAt: T('2026-11-21T06:00:00Z'), durationMin: 60 }],
}
const VIDEO = {
    id: 'v1',
    workspaceId: 'w1',
    memberUserId: 'u-video',
    title: 'Спарринг',
    message: null,
    status: 'open',
    createdAt: T('2026-11-13T09:00:00Z'),
    member: person('u-video', 'Олег', 'oleg@b.com'),
    clip: { status: 'processing', duration: 95 },
    _count: { comments: 2 },
}

const build = (
    opts: {
        sections?: { subscriptionEnabled?: boolean; videosEnabled?: boolean }
        rows?: { join?: unknown[]; freeze?: unknown[]; personal?: unknown[]; video?: unknown[] }
    } = {},
) => {
    const rows = {
        join: [JOIN],
        freeze: [FREEZE],
        personal: [PERSONAL],
        video: [VIDEO],
        ...opts.rows,
    }
    const model = (list: unknown[]) => ({
        count: jest.fn().mockResolvedValue(list.length),
        findMany: jest.fn().mockResolvedValue(list),
    })
    const prisma = {
        // resolveCoachScope's read and the sections' read.
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: OWNER,
                coachSeesAllGroups: false,
                subscriptionEnabled: opts.sections?.subscriptionEnabled ?? true,
                videosEnabled: opts.sections?.videosEnabled ?? true,
                billing: null,
                moduleEntitlements: [],
            }),
        },
        workspaceMember: model(rows.join),
        subscriptionFreezeRequest: model(rows.freeze),
        personalTrainingRequest: model(rows.personal),
        videoReviewRequest: model(rows.video),
        groupMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'u-video' }]) },
    }
    const handler = new ListOpenRequestsHandler(prisma as never, new RbacService(prisma as never))
    const run = (
        userId: string,
        roleName: string | null,
        payload: { kind?: 'join' | 'freeze' | 'personal' | 'video'; curPage?: number; perPage?: number } = {},
    ) => handler.execute(new ListOpenRequestsFeature(payload, 'w1', userId, roleName, false))
    return { prisma, run }
}

const whereOf = (fn: jest.Mock) => fn.mock.calls[0][0].where

describe('ListOpenRequestsHandler', () => {
    it('refuses a student (resolveCoachScope)', async () => {
        const { prisma, run } = build()
        await expect(run('u-join', 'user')).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.personalTrainingRequest.findMany).not.toHaveBeenCalled()
    })

    it('the owner without a member row sees every kind, oldest first', async () => {
        const { prisma, run } = build()
        const out = await run(OWNER, null)
        expect(out.kinds).toEqual(['join', 'freeze', 'personal', 'video'])
        expect(out.counts).toEqual({ join: 1, freeze: 1, personal: 1, video: 1, total: 4 })
        expect(out.data.map((r) => r.id)).toEqual(['join:m1', 'freeze:f1', 'personal:p1', 'video:v1'])
        expect(out).toMatchObject({ total: 4, curPage: 1, perPage: 50 })
        // A club admin also decides staff applicants.
        expect(whereOf(prisma.workspaceMember.findMany)).toEqual({ workspaceId: 'w1', status: 'INVITED' })
        expect(whereOf(prisma.personalTrainingRequest.findMany)).not.toHaveProperty('coachId')
    })

    it('a plain coach: no join, personal requests to them, own-group freezes and videos', async () => {
        const { prisma, run } = build()
        const out = await run('coach', 'coach')
        expect(out.kinds).toEqual(['freeze', 'personal', 'video'])
        expect(out.counts.join).toBe(0)
        expect(out.data.map((r) => r.kind)).toEqual(['freeze', 'personal', 'video'])
        expect(prisma.workspaceMember.count).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
        expect(whereOf(prisma.personalTrainingRequest.findMany)).toMatchObject({
            coachId: 'coach',
            memberId: { not: 'coach' },
        })
        expect(whereOf(prisma.subscriptionFreezeRequest.findMany)).toMatchObject({
            userId: { not: 'coach' },
        })
        expect(whereOf(prisma.videoReviewRequest.findMany).OR[0]).toEqual({
            memberUserId: { in: ['u-video'] },
        })
    })

    it('a head coach: joins without pending staff rows', async () => {
        const { prisma, run } = build()
        const out = await run('hc', 'head_coach')
        expect(out.kinds).toContain('join')
        expect(whereOf(prisma.workspaceMember.findMany).role).toEqual({
            name: { notIn: ['admin', 'head_coach', 'coach'] },
        })
        expect(whereOf(prisma.personalTrainingRequest.findMany)).not.toHaveProperty('coachId')
    })

    it('«Абонемент» off: no freeze kind; «Видео» off: no video kind', async () => {
        const { prisma, run } = build({
            sections: { subscriptionEnabled: false, videosEnabled: false },
        })
        const out = await run(OWNER, null)
        expect(out.kinds).toEqual(['join', 'personal'])
        expect(out.counts).toMatchObject({ freeze: 0, video: 0, total: 2 })
        expect(prisma.subscriptionFreezeRequest.findMany).not.toHaveBeenCalled()
        expect(prisma.videoReviewRequest.count).not.toHaveBeenCalled()
    })

    it('a kind filter narrows the rows and the total, not the counts', async () => {
        const { run } = build()
        const out = await run(OWNER, null, { kind: 'freeze', perPage: 1 })
        expect(out.data.map((r) => r.kind)).toEqual(['freeze'])
        expect(out.total).toBe(1)
        expect(out.counts.total).toBe(4)
        expect(out.perPage).toBe(1)
    })

    it('serializes every kind flat, with one detail set', async () => {
        const { run } = build()
        const out = await run(OWNER, null)
        expect(out.data).toEqual([
            {
                id: 'join:m1',
                kind: 'join',
                requestId: 'u-join',
                createdAt: '2026-11-10T09:00:00.000Z',
                member: {
                    userId: 'u-join',
                    name: 'Анна Петрова',
                    email: 'anna@b.com',
                    isDependent: false,
                    guardians: [],
                },
                join: { roleName: 'user' },
                freeze: null,
                personal: null,
                video: null,
            },
            {
                id: 'freeze:f1',
                kind: 'freeze',
                requestId: 'f1',
                createdAt: '2026-11-11T09:00:00.000Z',
                member: {
                    userId: 'u-kid',
                    name: 'Маша Петрова',
                    email: null,
                    isDependent: true,
                    guardians: [
                        {
                            userId: 'g1',
                            firstname: 'Ольга',
                            lastname: 'Петрова',
                            email: 'olga@b.com',
                            phone: '+79990000000',
                            relation: 'PARENT',
                            confirmed: true,
                        },
                    ],
                },
                join: null,
                freeze: {
                    fromDate: '2026-11-18',
                    untilDate: '2026-11-27',
                    days: 10,
                    reason: 'Болезнь',
                    planName: '12 занятий',
                    subscriptionId: 's1',
                    subscriptionEndDate: '2026-12-20T00:00:00.000Z',
                },
                personal: null,
                video: null,
            },
            {
                id: 'personal:p1',
                kind: 'personal',
                requestId: 'p1',
                createdAt: '2026-11-12T09:00:00.000Z',
                member: {
                    userId: 'u-pt',
                    name: 'Игорь Петрова',
                    email: 'igor@b.com',
                    isDependent: false,
                    guardians: [],
                },
                join: null,
                freeze: null,
                personal: {
                    coach: { userId: 'coach', name: 'Пётр Иванов' },
                    gymName: 'Зал на Ленина',
                    timezone: 'Asia/Tomsk',
                    memberComment: 'Хочу поработать над техникой',
                    options: [{ id: 'o2', startAt: '2026-11-21T06:00:00.000Z', durationMin: 60 }],
                },
                video: null,
            },
            {
                id: 'video:v1',
                kind: 'video',
                requestId: 'v1',
                createdAt: '2026-11-13T09:00:00.000Z',
                member: {
                    userId: 'u-video',
                    name: 'Олег Петрова',
                    email: 'oleg@b.com',
                    isDependent: false,
                    guardians: [],
                },
                join: null,
                freeze: null,
                personal: null,
                video: {
                    title: 'Спарринг',
                    message: null,
                    clipStatus: 'processing',
                    durationSec: 95,
                    commentCount: 2,
                },
            },
        ])
    })

    it('a ready clip reads ready; an open-ended abonement has no end date', async () => {
        const { run } = build({
            rows: {
                video: [{ ...VIDEO, clip: { status: 'ready', duration: null } }],
                freeze: [{ ...FREEZE, subscription: { endDate: null, plan: { name: 'Пакет' } } }],
            },
        })
        const out = await run(OWNER, null)
        expect(out.data.find((r) => r.kind === 'video')?.video).toMatchObject({
            clipStatus: 'ready',
            durationSec: null,
        })
        expect(out.data.find((r) => r.kind === 'freeze')?.freeze?.subscriptionEndDate).toBeNull()
    })
})
