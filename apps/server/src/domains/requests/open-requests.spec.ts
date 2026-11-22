import { BadRequestError } from '../../shared/errors/shared.errors'
import { displayStatus as personalDisplayStatus } from '../../features/personal-trainings/personal-training-utils'
import { displayStatus as reviewDisplayStatus } from '../../features/video-reviews/video-reviews-utils'
import {
    applicableRequestKinds,
    countOpenRequests,
    freezeRequestScopeWhere,
    loadOpenRequests,
    OPEN_REVIEW_CLIP_STATUSES,
    openPersonalTrainingWhere,
    openVideoReviewWhere,
    pendingFreezeWhere,
    pendingJoinWhere,
    type RequestViewer,
    REQUESTS_TOO_DEEP_MESSAGE,
} from './open-requests'

const NOW = new Date('2026-11-15T10:00:00Z')
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000)

const viewer = (over: Partial<RequestViewer> = {}): RequestViewer => ({
    workspaceId: 'w1',
    userId: 'me',
    clubWide: true,
    clubAdmin: true,
    ownGroupMemberIds: jest.fn().mockResolvedValue(['s1', 's2']),
    sections: { subscription: true, videos: true },
    ...over,
})
const clubAdmin = () => viewer()
const headCoach = () => viewer({ clubAdmin: false })
const coach = () => viewer({ clubWide: false, clubAdmin: false })

describe('pendingJoinWhere', () => {
    it('a club admin decides every applicant', () => {
        expect(pendingJoinWhere(clubAdmin())).toEqual({ workspaceId: 'w1', status: 'INVITED' })
    })

    it('a head coach never sees a pending staff applicant', () => {
        expect(pendingJoinWhere(headCoach())).toEqual({
            workspaceId: 'w1',
            status: 'INVITED',
            role: { name: { notIn: ['admin', 'head_coach', 'coach'] } },
        })
    })

    it('a plain coach decides no join request', () => {
        expect(pendingJoinWhere(coach())).toBeNull()
    })
})

describe('pendingFreezeWhere', () => {
    it('club-wide: every pending request on a current abonement of an active member', () => {
        expect(pendingFreezeWhere(headCoach(), NOW)).toEqual({
            workspaceId: 'w1',
            status: 'PENDING',
            subscription: {
                NOT: { workspaceMemberId: null },
                status: 'ACTIVE',
                OR: [{ endDate: null }, { endDate: { gt: NOW } }],
                workspaceMember: { status: 'ACTIVE' },
            },
        })
    })

    it('a coach: members of own groups (coached or of a run direction), never their own', () => {
        const where = pendingFreezeWhere(coach(), NOW)
        expect(where).toMatchObject({
            userId: { not: 'me' },
            user: {
                groupMemberships: {
                    some: {
                        group: {
                            workspaceId: 'w1',
                            OR: [
                                { coaches: { some: { userId: 'me' } } },
                                { direction: { managers: { some: { userId: 'me' } } } },
                            ],
                        },
                    },
                },
            },
        })
    })

    it('«Абонемент» off: no freeze kind; the staff queue keeps its rule', () => {
        const off = viewer({ sections: { subscription: false, videos: true } })
        expect(pendingFreezeWhere(off, NOW)).toBeNull()
        expect(freezeRequestScopeWhere(off, NOW)).toMatchObject({ status: 'PENDING' })
    })
})

// Applies openPersonalTrainingWhere to an in-memory row, the way Postgres would.
type PersonalWhere = {
    status: string
    memberId: { not: string }
    coachId?: string
    options: { some: { proposedBy: string; startAt: { gt: Date } } }
}
const matchesPersonal = (v: RequestViewer, r: Row): boolean => {
    // The builder's exact shape is pinned by the toEqual case below.
    const where = openPersonalTrainingWhere(v, NOW) as PersonalWhere
    const { proposedBy, startAt } = where.options.some
    return (
        r.status === where.status &&
        r.memberId !== where.memberId.not &&
        (where.coachId === undefined || r.coachId === where.coachId) &&
        r.options.some((o) => o.proposedBy === proposedBy && o.startAt > startAt.gt)
    )
}
type Row = {
    status: 'PENDING_COACH' | 'PENDING_MEMBER' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED'
    memberId: string
    coachId: string
    options: { proposedBy: string; startAt: Date }[]
}
const option = (proposedBy: string, startAt: Date, i: number) => ({
    id: `o${i}`,
    proposedBy,
    startAt,
    durationMin: 60,
    createdAt: at(-48 + i),
})

describe('openPersonalTrainingWhere', () => {
    it('a coach sees requests to them; club-wide viewers act for any coach', () => {
        expect(openPersonalTrainingWhere(coach(), NOW)).toEqual({
            workspaceId: 'w1',
            status: 'PENDING_COACH',
            options: { some: { proposedBy: 'member', startAt: { gt: NOW } } },
            memberId: { not: 'me' },
            coachId: 'me',
        })
        expect(openPersonalTrainingWhere(clubAdmin(), NOW)).not.toHaveProperty('coachId')
    })

    const rows: Array<[string, Row]> = [
        ['one member time ahead', { status: 'PENDING_COACH', memberId: 'm1', coachId: 'me', options: [{ proposedBy: 'member', startAt: at(-2) }, { proposedBy: 'member', startAt: at(5) }] }],
        ['every member time passed', { status: 'PENDING_COACH', memberId: 'm1', coachId: 'me', options: [{ proposedBy: 'member', startAt: at(-2) }, { proposedBy: 'member', startAt: at(-1) }] }],
        ['only a coach time ahead', { status: 'PENDING_COACH', memberId: 'm1', coachId: 'me', options: [{ proposedBy: 'member', startAt: at(-1) }, { proposedBy: 'coach', startAt: at(3) }] }],
        ['waiting on the member', { status: 'PENDING_MEMBER', memberId: 'm1', coachId: 'me', options: [{ proposedBy: 'member', startAt: at(4) }, { proposedBy: 'coach', startAt: at(6) }] }],
        ['confirmed', { status: 'CONFIRMED', memberId: 'm1', coachId: 'me', options: [{ proposedBy: 'member', startAt: at(4) }] }],
        ['declined', { status: 'DECLINED', memberId: 'm1', coachId: 'me', options: [{ proposedBy: 'member', startAt: at(4) }] }],
    ]

    it.each(rows)('agrees with displayStatus: %s', (_, r) => {
        const open =
            personalDisplayStatus(
                {
                    status: r.status,
                    confirmedStartAt: null,
                    confirmedDurationMin: null,
                    options: r.options.map((o, i) => option(o.proposedBy, o.startAt, i)),
                },
                NOW,
            ) === 'PENDING_COACH'
        expect(matchesPersonal(coach(), r)).toBe(open)
    })

    it('never lists a request the viewer filed as the member', () => {
        const mine: Row = { status: 'PENDING_COACH', memberId: 'me', coachId: 'c2', options: [{ proposedBy: 'member', startAt: at(5) }] }
        expect(matchesPersonal(clubAdmin(), mine)).toBe(false)
    })

    it("a coach doesn't see another coach's request", () => {
        const other: Row = { status: 'PENDING_COACH', memberId: 'm1', coachId: 'c2', options: [{ proposedBy: 'member', startAt: at(5) }] }
        expect(matchesPersonal(coach(), other)).toBe(false)
        expect(matchesPersonal(headCoach(), other)).toBe(true)
    })
})

describe('openVideoReviewWhere', () => {
    it.each(['uploading', 'uploaded', 'processing', 'ready', 'failed'])(
        'a clip %s is open exactly when the app shows it waiting',
        (clip) => {
            const shown = reviewDisplayStatus(clip, 'open')
            expect(OPEN_REVIEW_CLIP_STATUSES.includes(clip)).toBe(
                shown === 'open' || shown === 'processing',
            )
        },
    )

    it('club-wide: every open review but their own, without reading group members', async () => {
        const v = headCoach()
        expect(await openVideoReviewWhere(v)).toEqual({
            workspaceId: 'w1',
            status: 'open',
            clip: { status: { in: ['uploaded', 'processing', 'ready'] } },
            memberUserId: { not: 'me' },
        })
        expect(v.ownGroupMemberIds).not.toHaveBeenCalled()
    })

    it('a coach: own groups plus members no group coach looks after', async () => {
        expect(await openVideoReviewWhere(coach())).toMatchObject({
            memberUserId: { not: 'me' },
            OR: [
                { memberUserId: { in: ['s1', 's2'] } },
                {
                    member: {
                        groupMemberships: {
                            none: { group: { workspaceId: 'w1', coaches: { some: {} } } },
                        },
                    },
                },
            ],
        })
    })

    it('«Видео» off: no video kind', async () => {
        expect(
            await openVideoReviewWhere(viewer({ sections: { subscription: true, videos: false } })),
        ).toBeNull()
    })
})

describe('applicableRequestKinds', () => {
    it('follows the viewer scope and the club sections', () => {
        expect(applicableRequestKinds(headCoach())).toEqual(['join', 'freeze', 'personal', 'video'])
        expect(applicableRequestKinds(coach())).toEqual(['freeze', 'personal', 'video'])
        expect(
            applicableRequestKinds(
                viewer({ clubWide: false, sections: { subscription: false, videos: false } }),
            ),
        ).toEqual(['personal'])
    })
})

// ---- loaders ----

const row = (id: string, createdAt: Date) => ({ id, createdAt })

const prismaWith = (rows: {
    join?: unknown[]
    freeze?: unknown[]
    personal?: unknown[]
    video?: unknown[]
}) => {
    const model = (list: unknown[] = []) => ({
        count: jest.fn().mockResolvedValue(list.length),
        findMany: jest.fn(async ({ take }: { take: number }) => list.slice(0, take)),
    })
    return {
        workspaceMember: model(rows.join),
        subscriptionFreezeRequest: model(rows.freeze),
        personalTrainingRequest: model(rows.personal),
        videoReviewRequest: model(rows.video),
    }
}

describe('countOpenRequests', () => {
    it('counts each kind in scope; a kind that does not apply is 0 without a query', async () => {
        const prisma = prismaWith({
            join: [row('j1', at(-1))],
            freeze: [row('f1', at(-2)), row('f2', at(-1))],
            personal: [row('p1', at(-3))],
            video: [row('v1', at(-4))],
        })
        await expect(
            countOpenRequests(
                prisma as never,
                viewer({ clubWide: false, sections: { subscription: true, videos: false } }),
                NOW,
            ),
        ).resolves.toEqual({ join: 0, freeze: 2, personal: 1, video: 0, total: 3 })
        expect(prisma.workspaceMember.count).not.toHaveBeenCalled()
        expect(prisma.videoReviewRequest.count).not.toHaveBeenCalled()
    })
})

describe('loadOpenRequests', () => {
    const rows = {
        join: [row('j1', at(-5)), row('j2', at(-1))],
        freeze: [row('f1', at(-6)), row('f2', at(-3))],
        personal: [row('p1', at(-4))],
        // Same instant as p1: the uuid decides.
        video: [row('a1', at(-4)), row('v2', at(-2))],
    }

    it('merges every kind oldest first and slices the page', async () => {
        const prisma = prismaWith(rows)
        const page1 = await loadOpenRequests(prisma as never, clubAdmin(), NOW, {
            curPage: 1,
            perPage: 3,
        })
        expect(page1.rows.map((r) => `${r.kind}:${r.row.id}`)).toEqual([
            'freeze:f1',
            'join:j1',
            'video:a1',
        ])
        expect(page1.total).toBe(7)
        expect(prisma.subscriptionFreezeRequest.findMany.mock.calls[0][0]).toMatchObject({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 3,
        })

        const page2 = await loadOpenRequests(prismaWith(rows) as never, clubAdmin(), NOW, {
            curPage: 2,
            perPage: 3,
        })
        expect(page2.rows.map((r) => `${r.kind}:${r.row.id}`)).toEqual([
            'personal:p1',
            'freeze:f2',
            'video:v2',
        ])
        const page3 = await loadOpenRequests(prismaWith(rows) as never, clubAdmin(), NOW, {
            curPage: 3,
            perPage: 3,
        })
        expect(page3.rows.map((r) => `${r.kind}:${r.row.id}`)).toEqual(['join:j2'])
    })

    it('a kind filter reads one source; counts still cover every kind', async () => {
        const prisma = prismaWith(rows)
        const page = await loadOpenRequests(prisma as never, clubAdmin(), NOW, {
            kind: 'join',
            curPage: 1,
            perPage: 50,
        })
        expect(page.rows.map((r) => r.row.id)).toEqual(['j1', 'j2'])
        expect(page.total).toBe(2)
        expect(page.counts).toEqual({ join: 2, freeze: 2, personal: 1, video: 2, total: 7 })
        expect(prisma.subscriptionFreezeRequest.findMany).not.toHaveBeenCalled()
        expect(prisma.personalTrainingRequest.findMany).not.toHaveBeenCalled()
        expect(prisma.videoReviewRequest.findMany).not.toHaveBeenCalled()
    })

    it('a filter on a kind that does not apply is empty', async () => {
        const page = await loadOpenRequests(prismaWith(rows) as never, coach(), NOW, {
            kind: 'join',
            curPage: 1,
            perPage: 50,
        })
        expect(page.rows).toEqual([])
        expect(page.total).toBe(0)
        expect(page.counts.join).toBe(0)
    })

    it('refuses to read past 1000 rows deep', async () => {
        const prisma = prismaWith(rows)
        await expect(
            loadOpenRequests(prisma as never, clubAdmin(), NOW, { curPage: 11, perPage: 100 }),
        ).rejects.toThrow(new BadRequestError({ message: REQUESTS_TOO_DEEP_MESSAGE }))
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
        await expect(
            loadOpenRequests(prismaWith(rows) as never, clubAdmin(), NOW, {
                curPage: 10,
                perPage: 100,
            }),
        ).resolves.toMatchObject({ total: 7 })
    })
})
