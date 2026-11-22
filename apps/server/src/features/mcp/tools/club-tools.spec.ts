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

// Every read the overview makes answers empty, except the four request
// counts (by model) and the club's sections.
const build = (ws = workspace()) => {
    const counts = {
        // Student metrics count members too: only the pending applicants are 1.
        workspaceMember: jest.fn(async (a: { where: { status?: unknown } }) =>
            a.where.status === 'INVITED' ? 1 : 0,
        ),
        subscriptionFreezeRequest: jest.fn().mockResolvedValue(2),
        personalTrainingRequest: jest.fn().mockResolvedValue(3),
        videoReviewRequest: jest.fn().mockResolvedValue(4),
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
    const models = new Map<string, unknown>([['groupMember', groupMember]])
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
    return { prisma, counts, groupMember }
}

const run = async (a: AiAccess, ws = workspace()) => {
    const { prisma, counts, groupMember } = build(ws)
    const ctx = {
        prisma,
        access: a,
        scope: new McpScope(a),
        people: { personal: false },
        now: NOW,
    } as unknown as McpToolContext
    const out = await clubOverviewTool.run(ctx, {})
    return { requests: out.data.requests, counts, groupMember }
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
