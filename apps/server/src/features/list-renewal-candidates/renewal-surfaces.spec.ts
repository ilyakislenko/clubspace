// One definition of "due for renewal" behind every surface (spec B3): the
// «Продлить» list, the members filter «Кончается абонемент», the announcement
// audience «Только на продление» (push and feed) and the dashboard tile all
// name the same people for the same roster.
jest.mock('../../shared/access/assert-admin-scope', () => ({
    assertSportLead: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../domains/analytics/analytics-scope', () => ({
    ...jest.requireActual('../../domains/analytics/analytics-scope'),
    resolveAnalyticsScope: jest
        .fn()
        .mockResolvedValue({ scope: { groupIds: null, includeGroupless: true } }),
}))

import { countRenewalsDue } from '../../domains/subscriptions/renewal-rules'
import { memberAccessWhere } from '../list-workspace-members/list-workspace-members.handler'
import { GetAnnouncementFeedFeature } from '../manage-announcements/get-feed.feature'
import { GetAnnouncementFeedHandler } from '../manage-announcements/get-feed.handler'
import { announceToWorkspace } from '../manage-announcements/notify'
import { ListRenewalCandidatesFeature } from './list-renewal-candidates.feature'
import { ListRenewalCandidatesHandler } from './list-renewal-candidates.handler'

const DAY = 24 * 60 * 60 * 1000
const at = (days: number) => new Date(Date.now() + days * DAY)
const BJJ = { direction: { id: 'd-bjj', name: 'БЖЖ', color: null, icon: null } }

const sub = (o: {
    classesRemaining?: number | null
    endDate?: Date | null
    startDate?: Date | null
    status?: string
    directions?: (typeof BJJ)[]
}) => ({
    status: o.status ?? 'ACTIVE',
    startDate: o.startDate === undefined ? at(-10) : o.startDate,
    endDate: o.endDate === undefined ? at(30) : o.endDate,
    classesRemaining: o.classesRemaining ?? null,
    classesTotal: o.classesRemaining == null ? null : 8,
    plan: { id: 'p1', name: 'Абонемент' },
    directions: o.directions ?? [],
})

const student = (
    userId: string,
    accessUntil: Date | null,
    subscriptions: ReturnType<typeof sub>[],
) => ({
    userId,
    accessUntil,
    user: { firstname: userId, lastname: null, email: null, phone: null, dependentOf: [] },
    subscriptions,
})

// The roster the queries return (the student base and the abonement window
// are the database's job; each row is what renewalNeed judges).
const ROSTER = [
    student('out', at(30), [sub({ classesRemaining: 0 })]),
    student('low', at(30), [sub({ classesRemaining: 1 })]),
    student('ending', at(3), [sub({ endDate: at(3) })]),
    student('lapsed', at(-5), [sub({ status: 'EXPIRED', endDate: at(-5) })]),
    student('gone', at(-40), []),
    student('healthy', at(30), [sub({ classesRemaining: 6 })]),
    student('pending', at(2), [sub({ startDate: null, endDate: null })]),
    student('renewedAhead', at(60), [
        sub({ classesRemaining: 0, endDate: at(2), directions: [BJJ] }),
        sub({ classesRemaining: 12, endDate: at(60), directions: [BJJ] }),
    ]),
]
const DUE = ['out', 'low', 'ending', 'lapsed']

// `studentsIn({ where })` ANDs a caller's narrowing after the base: one
// member's id narrows the roster to that member (the feed's question).
const prisma = {
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
    },
    workspaceMember: {
        findMany: jest.fn(
            async (args: { where: { AND?: Array<{ userId?: unknown }> } }) => {
                const userId = args.where.AND?.[1]?.userId
                return typeof userId === 'string'
                    ? ROSTER.filter((m) => m.userId === userId)
                    : ROSTER
            },
        ),
        findFirst: jest.fn().mockResolvedValue({ role: { name: 'user' } }),
    },
    announcement: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
    },
    groupMember: { findMany: jest.fn().mockResolvedValue([]) },
    groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    // Nobody on autopay: the «Продлить» rows carry autopay: null.
    memberAutopay: { findMany: jest.fn().mockResolvedValue([]) },
}

const sorted = (ids: readonly string[]) => [...ids].sort()

describe('renewal surfaces share one definition', () => {
    it('list, members filter, push audience, feed and dashboard tile name the same members', async () => {
        const list = await new ListRenewalCandidatesHandler(
            prisma as never,
            {} as never,
        ).execute(
            new ListRenewalCandidatesFeature({}, 'w1', 'admin', 'admin', false),
        )
        const listed = list.data.map((c) => c.userId)
        expect(sorted(listed)).toEqual(sorted(DUE))
        expect(list.total).toBe(DUE.length)

        const filter = await memberAccessWhere(prisma as never, 'renew', {
            workspaceId: 'w1',
            workspaceOwnerId: 'owner',
            now: new Date(),
        })
        const filterIds =
            filter && typeof filter.userId === 'object' ? filter.userId.in : []
        expect(sorted(filterIds as string[])).toEqual(sorted(DUE))

        const notifyWorkspace = jest.fn()
        await announceToWorkspace(prisma as never, { notifyWorkspace } as never, {
            id: 'a1',
            workspaceId: 'w1',
            title: 'Ваш абонемент скоро закончится',
            body: '…',
            authorId: 'admin',
            audience: 'EXPIRING',
            directionId: null,
            groups: [],
        })
        expect(
            sorted(notifyWorkspace.mock.calls[0][0].memberWhere.userId.in),
        ).toEqual(sorted(DUE))

        const feedSegment: string[] = []
        for (const m of ROSTER) {
            prisma.announcement.findMany.mockClear()
            await new GetAnnouncementFeedHandler(prisma as never).execute(
                new GetAnnouncementFeedFeature({}, 'w1', m.userId),
            )
            const where = prisma.announcement.findMany.mock.calls[0][0].where
            if (where.audience === undefined) feedSegment.push(m.userId)
        }
        expect(sorted(feedSegment)).toEqual(sorted(DUE))

        // The dashboard tile «Продлить» (get-workspace-stats) counts with it.
        expect(await countRenewalsDue(prisma as never, 'w1', new Date())).toBe(
            DUE.length,
        )
    })
})
