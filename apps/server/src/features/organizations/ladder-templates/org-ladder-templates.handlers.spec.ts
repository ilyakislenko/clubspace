jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { CreateOrgLadderTemplateLevelFeature } from './create-org-ladder-template-level.feature'
import { CreateOrgLadderTemplateLevelHandler } from './create-org-ladder-template-level.handler'
import { CreateOrgLadderTemplateFeature } from './create-org-ladder-template.feature'
import { CreateOrgLadderTemplateHandler } from './create-org-ladder-template.handler'
import { DeleteOrgLadderTemplateLevelFeature } from './delete-org-ladder-template-level.feature'
import { DeleteOrgLadderTemplateLevelHandler } from './delete-org-ladder-template-level.handler'
import { DeleteOrgLadderTemplateFeature } from './delete-org-ladder-template.feature'
import { DeleteOrgLadderTemplateHandler } from './delete-org-ladder-template.handler'
import { ListOrgLadderTemplatesFeature } from './list-org-ladder-templates.feature'
import { ListOrgLadderTemplatesHandler } from './list-org-ladder-templates.handler'
import { UpdateOrgLadderTemplateLevelFeature } from './update-org-ladder-template-level.feature'
import { UpdateOrgLadderTemplateLevelHandler } from './update-org-ladder-template-level.handler'
import { UpdateOrgLadderTemplateFeature } from './update-org-ladder-template.feature'
import { UpdateOrgLadderTemplateHandler } from './update-org-ladder-template.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const orgRbac = { resolveOrgScope: jest.fn(async (c: object) => ({ ...c, role: 'ORG_COACH' })) }
const tpl = (o: Record<string, unknown> = {}) => ({
    id: 't1',
    organizationId: ORG,
    name: 'Пояса (взрослые)',
    audience: 'adult',
    version: 2,
    isActive: true,
    updatedAt: new Date('2026-11-26T00:00:00Z'),
    levels: [
        {
            id: 'l1',
            templateId: 't1',
            name: 'Белый',
            order: 0,
            color: '#fff',
            maxStripes: 4,
            requirements: null,
            minVisits: null,
            minWeeks: null,
        },
    ],
    ...o,
})

const makePrisma = (o: { found?: unknown; level?: unknown; p2002?: boolean } = {}) => {
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' })
    const prisma = {
        organizationLadderTemplate: {
            findFirst: jest.fn().mockResolvedValue(o.found === undefined ? { id: 't1', name: 'Пояса' } : o.found),
            findUniqueOrThrow: jest.fn().mockResolvedValue(tpl()),
            findMany: jest.fn().mockResolvedValue([tpl()]),
            create: jest.fn().mockResolvedValue({ id: 't1' }),
            update: jest.fn().mockReturnValue('bump'),
            delete: jest.fn().mockResolvedValue({}),
        },
        organizationLadderTemplateLevel: {
            findFirst: jest.fn().mockResolvedValue(o.level === undefined ? { id: 'l1', name: 'Белый' } : o.level),
            create: jest.fn().mockReturnValue('create'),
            update: jest.fn().mockReturnValue('update'),
            delete: jest.fn().mockReturnValue('delete'),
        },
        rankLadder: {
            findMany: jest.fn().mockResolvedValue([
                { templateId: 't1', templateVersion: 1, workspaceId: 'w1', workspace: { name: 'ACADEMY' } },
            ]),
        },
        organizationClub: { findMany: jest.fn() },
        $transaction: jest.fn(async (ops: unknown[]) => {
            if (o.p2002) throw p2002
            return ops
        }),
    }
    return prisma
}
const audit = () => ({ record: jest.fn() })

describe('org ladder templates', () => {
    it('lists the standards with the clubs that adopted them', async () => {
        const out = await new ListOrgLadderTemplatesHandler(makePrisma() as never, orgRbac as never).execute(
            new ListOrgLadderTemplatesFeature({}, ORG, 'u1', false),
        )
        expect(out.data[0]).toMatchObject({
            id: 't1',
            version: 2,
            adoptions: [{ clubId: 'w1', clubName: 'ACADEMY', version: 1 }],
        })
        expect(out.data[0].levels[0]).toMatchObject({ name: 'Белый', maxStripes: 4 })
    })

    it('creates a standard with its rungs and audits it', async () => {
        const prisma = makePrisma()
        const a = audit()
        await new CreateOrgLadderTemplateHandler(prisma as never, orgRbac as never, a as never).execute(
            new CreateOrgLadderTemplateFeature(
                { name: 'Пояса', levels: [{ name: 'Белый', order: 0 }, { name: 'Синий', order: 1 }] },
                ORG,
                'u1',
                false,
            ),
        )
        const data = prisma.organizationLadderTemplate.create.mock.calls[0][0].data
        expect(data.organizationId).toBe(ORG)
        expect(data.levels.create).toHaveLength(2)
        expect(a.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'org.templateCreate', organizationId: ORG }),
        )
        await expect(
            new CreateOrgLadderTemplateHandler(prisma as never, orgRbac as never, a as never).execute(
                new CreateOrgLadderTemplateFeature(
                    { name: 'x', levels: [{ name: 'a', order: 0 }, { name: 'b', order: 0 }] },
                    ORG,
                    'u1',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('renames without a version bump; deletes within the org', async () => {
        const prisma = makePrisma()
        await new UpdateOrgLadderTemplateHandler(prisma as never, orgRbac as never, audit() as never).execute(
            new UpdateOrgLadderTemplateFeature({ name: 'Новое' }, ORG, 't1', 'u1', false),
        )
        expect(prisma.organizationLadderTemplate.update.mock.calls[0][0].data).toEqual({ name: 'Новое' })
        await new DeleteOrgLadderTemplateHandler(prisma as never, orgRbac as never, audit() as never).execute(
            new DeleteOrgLadderTemplateFeature(ORG, 't1', 'u1', false),
        )
        expect(prisma.organizationLadderTemplate.delete).toHaveBeenCalledWith({ where: { id: 't1' } })
        expect(prisma.organizationLadderTemplate.findFirst.mock.calls[0][0].where).toEqual({
            id: 't1',
            organizationId: ORG,
        })
        await expect(
            new DeleteOrgLadderTemplateHandler(makePrisma({ found: null }) as never, orgRbac as never, audit() as never).execute(
                new DeleteOrgLadderTemplateFeature(ORG, 't1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('bumps the version with every level change', async () => {
        const prisma = makePrisma()
        await new CreateOrgLadderTemplateLevelHandler(prisma as never, orgRbac as never, audit() as never).execute(
            new CreateOrgLadderTemplateLevelFeature({ name: 'Синий', order: 1 }, ORG, 't1', 'u1', false),
        )
        await new UpdateOrgLadderTemplateLevelHandler(prisma as never, orgRbac as never, audit() as never).execute(
            new UpdateOrgLadderTemplateLevelFeature({ maxStripes: 3 }, ORG, 't1', 'l1', 'u1', false),
        )
        const out = await new DeleteOrgLadderTemplateLevelHandler(
            prisma as never,
            orgRbac as never,
            audit() as never,
        ).execute(new DeleteOrgLadderTemplateLevelFeature(ORG, 't1', 'l1', 'u1', false))
        expect(prisma.organizationLadderTemplate.update).toHaveBeenCalledTimes(3)
        for (const [arg] of prisma.organizationLadderTemplate.update.mock.calls) {
            expect(arg).toEqual({ where: { id: 't1' }, data: { version: { increment: 1 } } })
        }
        expect(prisma.$transaction.mock.calls.map(([ops]) => ops)).toEqual([
            ['create', 'bump'],
            ['update', 'bump'],
            ['delete', 'bump'],
        ])
        expect(out.version).toBe(2)
    })

    it('answers 409 on a taken order and 404 on a level of another standard', async () => {
        await expect(
            new CreateOrgLadderTemplateLevelHandler(makePrisma({ p2002: true }) as never, orgRbac as never, audit() as never).execute(
                new CreateOrgLadderTemplateLevelFeature({ name: 'x', order: 0 }, ORG, 't1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(ConflictError)
        await expect(
            new UpdateOrgLadderTemplateLevelHandler(makePrisma({ p2002: true }) as never, orgRbac as never, audit() as never).execute(
                new UpdateOrgLadderTemplateLevelFeature({ order: 0 }, ORG, 't1', 'l1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(ConflictError)
        await expect(
            new UpdateOrgLadderTemplateLevelHandler(makePrisma({ level: null }) as never, orgRbac as never, audit() as never).execute(
                new UpdateOrgLadderTemplateLevelFeature({ order: 0 }, ORG, 't1', 'l1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(
            new DeleteOrgLadderTemplateLevelHandler(makePrisma({ level: null }) as never, orgRbac as never, audit() as never).execute(
                new DeleteOrgLadderTemplateLevelFeature(ORG, 't1', 'l1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
