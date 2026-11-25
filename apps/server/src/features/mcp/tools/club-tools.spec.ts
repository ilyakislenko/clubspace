import { environment } from '../../../environments/environment'
import type { AiAccess } from '../../../domains/ai-assistant/ai-access'
import { McpScope } from '../mcp-scope'
import type { McpToolContext } from '../mcp-tool'
import { clubOverviewTool } from './club-tools'

const NOW = new Date('2026-11-15T12:00:00Z')

const access = (p: {
    roleName: string | null
    directionIds: string[] | null
}): AiAccess => ({
    workspaceId: 'w1',
    workspaceName: 'Клуб',
    timezone: 'Europe/Moscow',
    ownerId: 'u0',
    userId: p.roleName === null ? 'u0' : 'u1',
    roleName: p.roleName,
    isOwner: p.roleName === null,
    isClubAdmin: p.roleName === null || p.roleName === 'admin',
    directionIds: p.directionIds,
})

const OWNER = access({ roleName: null, directionIds: null })
const HEAD_COACH = access({ roleName: 'head_coach', directionIds: null })
const DIRECTION_MANAGER = access({ roleName: 'coach', directionIds: ['bjj'] })

const workspace = (over: { subscriptionEnabled?: boolean; videosEnabled?: boolean } = {}) => ({
    subscriptionEnabled: over.subscriptionEnabled ?? true,
    videosEnabled: over.videosEnabled ?? true,
    billing: null,
    moduleEntitlements: [],
})

type MessagesAggregate = {
    _count: { _all: number }
    _sum: { recipientCount: number | null; readCount: number | null }
}

// Every read the overview makes answers empty, except the four request
// counts (by model), the club's sections, the club messages aggregate and
// the club's federation links.
const build = (
    ws = workspace(),
    messages: MessagesAggregate = { _count: { _all: 0 }, _sum: { recipientCount: null, readCount: null } },
    links: unknown[] = [],
) => {
    const counts = {
        // Student metrics count members too: only the pending applicants are 1.
        workspaceMember: jest.fn(async (a: { where: { status?: unknown } }) =>
            a.where.status === 'INVITED' ? 1 : 0,
        ),
        subscriptionFreezeRequest: jest.fn().mockResolvedValue(2),
        personalTrainingRequest: jest.fn().mockResolvedValue(3),
        videoReviewRequest: jest.fn().mockResolvedValue(4),
        lead: jest.fn().mockResolvedValue(5),
    }
    const groupMember = {
        findMany: jest.fn().mockResolvedValue([{ userId: 's1' }]),
    }
    const empty = (model: string) => ({
        count: counts[model as keyof typeof counts] ?? jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {}, _count: {} }),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(ws),
    })
    const clubMessage = { aggregate: jest.fn().mockResolvedValue(messages) }
    const organizationClub = { findMany: jest.fn().mockResolvedValue(links) }
    const models = new Map<string, unknown>([
        ['groupMember', groupMember],
        ['clubMessage', clubMessage],
        ['organizationClub', organizationClub],
    ])
    const prisma = new Proxy(
        {},
        {
            get: (_, key: string) => {
                if (key === '$queryRaw' || key === '$queryRawUnsafe') {
                    return jest.fn().mockResolvedValue([])
                }
                if (!models.has(key)) models.set(key, empty(key))
                return models.get(key)
            },
        },
    )
    return { prisma, counts, groupMember, clubMessage, organizationClub }
}

const run = async (
    a: AiAccess,
    ws = workspace(),
    messages?: MessagesAggregate,
    links: unknown[] = [],
) => {
    const { prisma, counts, groupMember, clubMessage, organizationClub } = build(ws, messages, links)
    const ctx = {
        prisma,
        access: a,
        scope: new McpScope(a),
        people: { personal: false },
        now: NOW,
    } as unknown as McpToolContext
    const out = await clubOverviewTool.run(ctx, {})
    return {
        requests: out.data.requests,
        messages: out.data.messages,
        leads: out.data.leads,
        organizations: out.data.organizations,
        counts,
        groupMember,
        clubMessage,
        organizationClub,
    }
}

const whereOf = (fn: jest.Mock) => fn.mock.calls[0][0].where
// The student metrics count members too; the join count is the INVITED one.
const joinWhere = (fn: jest.Mock) =>
    fn.mock.calls.map((c) => c[0].where).find((w) => w.status === 'INVITED')

describe('club_overview requests', () => {
    it('the owner: every kind, staff applicants included', async () => {
        const { requests, counts, groupMember } = await run(OWNER)
        expect(requests).toEqual({ join: 1, freeze: 2, personal: 3, video: 4 })
        expect(joinWhere(counts.workspaceMember)).toEqual({ workspaceId: 'w1', status: 'INVITED' })
        expect(whereOf(counts.personalTrainingRequest)).not.toHaveProperty('coachId')
        expect(groupMember.findMany).not.toHaveBeenCalled()
    })

    it('a head coach: no pending staff applicants', async () => {
        const { counts } = await run(HEAD_COACH)
        expect(joinWhere(counts.workspaceMember).role).toEqual({
            name: { notIn: ['admin', 'head_coach', 'coach'] },
        })
    })

    it('a direction manager: no joins, their personal requests, their groups', async () => {
        const { requests, counts, groupMember } = await run(DIRECTION_MANAGER)
        expect(requests).toEqual({ join: 0, freeze: 2, personal: 3, video: 4 })
        expect(counts.workspaceMember).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ status: 'INVITED' }) }),
        )
        expect(whereOf(counts.personalTrainingRequest).coachId).toBe('u1')
        expect(whereOf(counts.subscriptionFreezeRequest).userId).toEqual({ not: 'u1' })
        expect(whereOf(counts.videoReviewRequest).OR[0]).toEqual({
            memberUserId: { in: ['s1'] },
        })
        expect(whereOf(groupMember.findMany).group).toMatchObject({
            workspaceId: 'w1',
            OR: [
                { coaches: { some: { userId: 'u1' } } },
                { direction: { managers: { some: { userId: 'u1' } } } },
            ],
        })
    })

    it('sections off: no freeze, no video', async () => {
        const { requests, counts } = await run(
            OWNER,
            workspace({ subscriptionEnabled: false, videosEnabled: false }),
        )
        expect(requests).toEqual({ join: 1, freeze: 0, personal: 3, video: 0 })
        expect(counts.subscriptionFreezeRequest).not.toHaveBeenCalled()
        expect(counts.videoReviewRequest).not.toHaveBeenCalled()
    })
})

describe('club_overview messages', () => {
    const since30 = new Date(NOW.getTime() - 30 * 86_400_000)

    it('a sport lead: the whole club’s sent messages over 30 days with the open share', async () => {
        const { messages, clubMessage } = await run(HEAD_COACH, workspace(), {
            _count: { _all: 4 },
            _sum: { recipientCount: 120, readCount: 45 },
        })
        expect(messages).toEqual({ sent30d: 4, recipients30d: 120, readShare: 0.38 })
        expect(clubMessage.aggregate.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: 'SENT',
            sentAt: { gte: since30 },
        })
    })

    it('a direction manager: only what the token’s creator wrote', async () => {
        const { clubMessage } = await run(DIRECTION_MANAGER)
        expect(clubMessage.aggregate.mock.calls[0][0].where.authorId).toBe('u1')
    })

    it('nothing sent: zero counts and no share', async () => {
        const { messages } = await run(OWNER)
        expect(messages).toEqual({ sent30d: 0, recipients30d: 0, readShare: null })
    })
})

// «Пробные» (docs/design/2026-11-26-leads.md §7): counts only, whole-club
// scope; no lead list or contact reaches the assistant.
describe('club_overview leads', () => {
    it('a sport lead gets three counts', async () => {
        const { leads, counts } = await run(HEAD_COACH)
        expect(leads).toEqual({ needsAction: 5, received30d: 0, bought30d: 0 })
        expect(whereOf(counts.lead)).toMatchObject({ workspaceId: 'w1', anonymizedAt: null })
    })

    it('a direction manager gets none', async () => {
        const { leads, counts } = await run(DIRECTION_MANAGER)
        expect(leads).toBeNull()
        expect(counts.lead).not.toHaveBeenCalled()
    })
})

// Federation hub (docs/design/2026-11-26-federation-hub-mvp.md §6): the
// club's federations and what it shares with each — whole-club scope only,
// no people.
describe('club_overview organizations', () => {
    const saved = environment.organizations.enabled
    beforeEach(() => {
        environment.organizations.enabled = true
    })
    afterAll(() => {
        environment.organizations.enabled = saved
    })
    const link = (status: 'ACTIVE' | 'INVITED', name: string) => ({
        status,
        shareRegistry: true,
        shareMrr: true,
        shareRevenue30d: false,
        allowMemberAnnouncements: false,
        allowMemberEvents: true,
        organization: { name },
    })

    it('a whole-club token sees each federation, its status and the shared figures', async () => {
        const { organizations, organizationClub } = await run(HEAD_COACH, workspace(), undefined, [
            link('ACTIVE', 'Федерация БЖЖ'),
            link('INVITED', 'Сеть клубов'),
        ])
        expect(organizations).toEqual([
            {
                name: 'Федерация БЖЖ',
                status: 'в федерации',
                shares: {
                    headlineNumbers: true,
                    beltRegistry: true,
                    mrr: true,
                    revenue30d: false,
                    announcementsInMembersFeed: false,
                    eventsForMembers: true,
                },
            },
            { name: 'Сеть клубов', status: 'приглашение ждёт решения владельца', shares: null },
        ])
        expect(whereOf(organizationClub.findMany)).toEqual({
            workspaceId: 'w1',
            status: { in: ['INVITED', 'ACTIVE'] },
            organization: { isActive: true },
        })
    })

    it('a direction manager gets none', async () => {
        const { organizations, organizationClub } = await run(DIRECTION_MANAGER)
        expect(organizations).toBeNull()
        expect(organizationClub.findMany).not.toHaveBeenCalled()
    })

    it('nothing while the hub is off', async () => {
        environment.organizations.enabled = false
        const { organizations, organizationClub } = await run(OWNER)
        expect(organizations).toBeNull()
        expect(organizationClub.findMany).not.toHaveBeenCalled()
    })
})
