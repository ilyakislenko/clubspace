const mockOrgFlag = { enabled: true }
jest.mock('../../environments/environment', () => ({
    environment: {
        get organizations() {
            return mockOrgFlag
        },
    },
}))

import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { CreateRankLadderFromTemplateFeature } from './create-ladder-from-template.feature'
import { CreateRankLadderFromTemplateHandler } from './create-ladder-from-template.handler'
import { ListLaddersFeature } from './list-ladders.feature'
import { ListLaddersHandler } from './list-ladders.handler'

const DIR = '11111111-1111-4111-8111-111111111111'
const template = {
    id: 't1',
    organizationId: 'org1',
    name: 'Пояса (взрослые)',
    audience: 'adult',
    version: 2,
    levels: [
        { id: 'tl1', name: 'Белый', order: 0, color: '#fff', maxStripes: 4, requirements: null, minVisits: null, minWeeks: null },
        { id: 'tl2', name: 'Синий', order: 1, color: '#00f', maxStripes: 4, requirements: 'Техника', minVisits: 100, minWeeks: 52 },
    ],
}

const makePrisma = (found: unknown = template) => ({
    direction: { findFirst: jest.fn().mockResolvedValue({ id: DIR }) },
    workspace: { findUnique: jest.fn().mockResolvedValue({ name: 'ACADEMY' }) },
    organizationLadderTemplate: { findFirst: jest.fn().mockResolvedValue(found) },
    rankLadder: {
        create: jest.fn(async ({ data }) => ({
            id: 'lad1',
            workspaceId: data.workspaceId,
            name: data.name,
            audience: data.audience,
            isActive: true,
            order: 0,
            templateId: data.templateId,
            templateVersion: data.templateVersion,
            direction: null,
            levels: data.levels.create.map((l: Record<string, unknown>, i: number) => ({
                id: `lv${i}`,
                ladderId: 'lad1',
                isActive: true,
                ...l,
            })),
        })),
    },
})

const makeRbac = (canManage = true) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'coach_own_only' }),
    assertCanManageDirection: jest.fn(async () => {
        if (!canManage) throw new ForbiddenError({ message: 'Только своё направление' })
    }),
})

const run = (prisma: ReturnType<typeof makePrisma>, rbac = makeRbac(), payload = {}) => {
    const audit = { record: jest.fn() }
    return {
        audit,
        result: new CreateRankLadderFromTemplateHandler(
            prisma as never,
            rbac as never,
            audit as never,
        ).execute(
            new CreateRankLadderFromTemplateFeature(
                { templateId: 't1', directionId: DIR, ...payload },
                'w1',
                'u1',
                'coach',
                false,
            ),
        ),
    }
}

describe('createRankLadderFromTemplate', () => {
    afterEach(() => {
        mockOrgFlag.enabled = true
    })

    it('copies every level with provenance into an editable club ladder', async () => {
        const prisma = makePrisma()
        const { result, audit } = run(prisma)
        const out = await result
        const data = prisma.rankLadder.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: 'w1',
            name: 'Пояса (взрослые)',
            audience: 'adult',
            directionId: DIR,
            templateId: 't1',
            templateVersion: 2,
        })
        expect(data.levels.create).toEqual([
            expect.objectContaining({ name: 'Белый', order: 0, templateLevelId: 'tl1' }),
            expect.objectContaining({
                name: 'Синий',
                requirements: 'Техника',
                minVisits: 100,
                minWeeks: 52,
                templateLevelId: 'tl2',
            }),
        ])
        expect(out).toMatchObject({ id: 'lad1', templateId: 't1', templateVersion: 2 })
        expect(out.levels).toHaveLength(2)
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'ladder.fromTemplate',
                workspaceId: 'w1',
                organizationId: 'org1',
                targetId: 'lad1',
                metadata: expect.objectContaining({ clubName: 'ACADEMY', templateVersion: 2 }),
            }),
        )
        // Only a standard of an org this club is ACTIVE in.
        expect(prisma.organizationLadderTemplate.findFirst.mock.calls[0][0].where).toEqual({
            id: 't1',
            isActive: true,
            organization: {
                isActive: true,
                clubs: { some: { workspaceId: 'w1', status: 'ACTIVE' } },
            },
        })
    })

    it('takes a new name when given', async () => {
        const prisma = makePrisma()
        await run(prisma, makeRbac(), { name: 'Наша лестница' }).result
        expect(prisma.rankLadder.create.mock.calls[0][0].data.name).toBe('Наша лестница')
    })

    it('refuses a direction outside the coach scope (403)', async () => {
        const prisma = makePrisma()
        await expect(run(prisma, makeRbac(false)).result).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.rankLadder.create).not.toHaveBeenCalled()
    })

    it("answers 404 for a standard of another org and when the hub is off", async () => {
        await expect(run(makePrisma(null)).result).rejects.toBeInstanceOf(NotFoundError)
        mockOrgFlag.enabled = false
        await expect(run(makePrisma()).result).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('listRankLadders with federation standards', () => {
    const ladders = [
        {
            id: 'lad1',
            workspaceId: 'w1',
            name: 'БЖЖ',
            audience: null,
            isActive: true,
            order: 0,
            direction: null,
            levels: [],
            templateId: 't1',
            templateVersion: 1,
        },
    ]
    const prismaFor = () => ({
        rankLadder: { findMany: jest.fn().mockResolvedValue(ladders) },
        organizationLadderTemplate: {
            findMany: jest.fn().mockResolvedValue([
                { id: 't1', name: 'Пояса', version: 2, organization: { name: 'Федерация' } },
            ]),
        },
    })
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        assertManagesDirections: jest.fn().mockResolvedValue(null),
    }

    it('names the standards the ladders were copied from, with their current version', async () => {
        const prisma = prismaFor()
        const out = await new ListLaddersHandler(prisma as never, rbac as never).execute(
            new ListLaddersFeature({}, 'w1', 'u1', 'admin', false),
        )
        expect(out.data[0]).toMatchObject({ templateId: 't1', templateVersion: 1 })
        expect(out.templates).toEqual([
            { id: 't1', name: 'Пояса', organizationName: 'Федерация', version: 2 },
        ])
    })

    it('reads no standards while the hub is off', async () => {
        mockOrgFlag.enabled = false
        const prisma = prismaFor()
        const out = await new ListLaddersHandler(prisma as never, rbac as never).execute(
            new ListLaddersFeature({}, 'w1', 'u1', 'admin', false),
        )
        mockOrgFlag.enabled = true
        expect(out.templates).toEqual([])
        expect(prisma.organizationLadderTemplate.findMany).not.toHaveBeenCalled()
    })
})
