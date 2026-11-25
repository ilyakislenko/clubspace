import { ForbiddenError } from '../../../shared/errors/shared.errors'
import { ListAdoptableLadderTemplatesFeature } from './list-adoptable-ladder-templates.feature'
import { ListAdoptableLadderTemplatesHandler } from './list-adoptable-ladder-templates.handler'

const rbac = (allowed = true) => ({
    resolveCoachScope: jest.fn(async () => {
        if (!allowed) throw new ForbiddenError({ message: 'Нужны права' })
        return { scope: 'admin' }
    }),
    assertManagesDirections: jest.fn().mockResolvedValue(null),
})

describe('listAdoptableLadderTemplates', () => {
    it("lists active standards of the club's ACTIVE orgs with this club's copies", async () => {
        const prisma = {
            organizationLadderTemplate: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 't1',
                        organizationId: 'org1',
                        organization: { name: 'Федерация' },
                        name: 'Пояса (взрослые)',
                        audience: 'adult',
                        version: 2,
                        levels: [
                            { id: 'l1', name: 'Белый', order: 0, color: '#fff', maxStripes: 4, requirements: 'x' },
                        ],
                    },
                ]),
            },
            rankLadder: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'lad1', name: 'БЖЖ', templateId: 't1', templateVersion: 1 },
                ]),
            },
        }
        const r = rbac()
        const out = await new ListAdoptableLadderTemplatesHandler(prisma as never, r as never).execute(
            new ListAdoptableLadderTemplatesFeature('w1', 'u1', 'head_coach', false),
        )
        expect(r.assertManagesDirections).toHaveBeenCalled()
        expect(out.data).toEqual([
            {
                id: 't1',
                organizationId: 'org1',
                organizationName: 'Федерация',
                name: 'Пояса (взрослые)',
                audience: 'adult',
                version: 2,
                levels: [{ id: 'l1', name: 'Белый', order: 0, color: '#fff', maxStripes: 4 }],
                adoptedLadders: [{ ladderId: 'lad1', ladderName: 'БЖЖ', templateVersion: 1 }],
            },
        ])
        expect(prisma.organizationLadderTemplate.findMany.mock.calls[0][0].where).toEqual({
            isActive: true,
            organization: {
                isActive: true,
                clubs: { some: { workspaceId: 'w1', status: 'ACTIVE' } },
            },
        })
    })

    it('refuses a member', async () => {
        await expect(
            new ListAdoptableLadderTemplatesHandler({} as never, rbac(false) as never).execute(
                new ListAdoptableLadderTemplatesFeature('w1', 'u1', 'user', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
