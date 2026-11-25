jest.mock('../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import { GetAnnouncementFeedFeature } from './get-feed.feature'
import { GetAnnouncementFeedHandler } from './get-feed.handler'

// Federation announcements merged into a club feed (design
// docs/design/2026-11-26-federation-hub-mvp.md §3.3).
const clubRow = (id: string, publishedAt: string, pinned = false) => ({
    id,
    title: `club ${id}`,
    body: 'b',
    pinned,
    audience: 'ALL',
    direction: null,
    groups: [],
    publishedAt: new Date(publishedAt),
    author: { firstname: 'Coach', lastname: null, email: null },
    createdAt: new Date(publishedAt),
    updatedAt: new Date(publishedAt),
})
const orgRow = (id: string, publishedAt: string) => ({
    id,
    organizationId: '33333333-3333-4333-8333-333333333333',
    title: `org ${id}`,
    body: 'b',
    publishedAt: new Date(publishedAt),
    authorName: 'Николай Белов',
    createdAt: new Date(publishedAt),
    updatedAt: new Date(publishedAt),
    organization: { name: 'Федерация БЖЖ' },
})

const run = async (o: {
    role: string | null
    owner?: boolean
    club?: unknown[]
    org?: unknown[]
    curPage?: number
    perPage?: number
}) => {
    const prisma = {
        announcement: {
            findMany: jest.fn().mockResolvedValue(o.club ?? []),
            count: jest.fn().mockResolvedValue((o.club ?? []).length),
        },
        organizationAnnouncement: {
            findMany: jest.fn().mockResolvedValue(o.org ?? []),
            count: jest.fn().mockResolvedValue((o.org ?? []).length),
        },
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.role ? { role: { name: o.role } } : null),
            findMany: jest.fn().mockResolvedValue([]),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: o.owner ? 'u1' : 'someone' }),
        },
        groupMember: { findMany: jest.fn().mockResolvedValue([]) },
        groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const out = await new GetAnnouncementFeedHandler(prisma as never).execute(
        new GetAnnouncementFeedFeature(
            { curPage: o.curPage, perPage: o.perPage },
            'w1',
            'u1',
        ),
    )
    return { out, prisma }
}

describe('getAnnouncementFeed with federation announcements', () => {
    it('shows a member only members-audience items of ACTIVE orgs whose club allows them', async () => {
        const { prisma } = await run({ role: 'user' })
        const where = prisma.organizationAnnouncement.findMany.mock.calls[0][0].where
        expect(where.publishedAt.lte).toBeInstanceOf(Date)
        expect(where.audience).toBe('STAFF_AND_MEMBERS')
        expect(where.organization).toEqual({
            isActive: true,
            clubs: {
                some: {
                    workspaceId: 'w1',
                    status: 'ACTIVE',
                    allowMemberAnnouncements: true,
                },
            },
        })
    })

    it('shows club staff every item of ACTIVE orgs, the club switch aside', async () => {
        for (const viewer of [{ role: 'coach' }, { role: null, owner: true }]) {
            const { prisma } = await run(viewer)
            const where =
                prisma.organizationAnnouncement.findMany.mock.calls[0][0].where
            expect(where.audience).toBeUndefined()
            expect(where.organization.clubs.some).toEqual({
                workspaceId: 'w1',
                status: 'ACTIVE',
            })
        }
    })

    it('merges both sources: pinned club items first, then newest, tagged with source', async () => {
        const { out } = await run({
            role: 'user',
            club: [
                clubRow('c-pinned', '2026-07-01T00:00:00Z', true),
                clubRow('c-old', '2026-07-02T00:00:00Z'),
            ],
            org: [orgRow('o-new', '2026-07-05T00:00:00Z')],
        })
        expect(out.data.map((a) => a.id)).toEqual(['c-pinned', 'o-new', 'c-old'])
        expect(out.total).toBe(3)
        expect(out.data[1]).toMatchObject({
            pinned: false,
            audience: 'ALL',
            direction: null,
            groups: [],
            authorName: 'Николай Белов',
            source: {
                kind: 'organization',
                organizationId: '33333333-3333-4333-8333-333333333333',
                name: 'Федерация БЖЖ',
            },
        })
        expect(out.data[0].source).toBeUndefined()
    })

    it('cuts the second page out of the merged order', async () => {
        const { out, prisma } = await run({
            role: 'user',
            curPage: 2,
            perPage: 1,
            club: [clubRow('c1', '2026-07-03T00:00:00Z'), clubRow('c2', '2026-07-01T00:00:00Z')],
            org: [orgRow('o1', '2026-07-02T00:00:00Z')],
        })
        expect(prisma.announcement.findMany.mock.calls[0][0].take).toBe(2)
        expect(prisma.organizationAnnouncement.findMany.mock.calls[0][0].take).toBe(2)
        expect(out.data.map((a) => a.id)).toEqual(['o1'])
    })
})
