import { loadTemplateAdoptions } from './templates'

describe('template adoptions', () => {
    it('lists active member clubs per template with the newest version each copied', async () => {
        const prisma = {
            rankLadder: {
                findMany: jest.fn().mockResolvedValue([
                    { templateId: 't1', templateVersion: 1, workspaceId: 'w2', workspace: { name: 'Беркут' } },
                    { templateId: 't1', templateVersion: 1, workspaceId: 'w1', workspace: { name: 'ACADEMY' } },
                    { templateId: 't1', templateVersion: 2, workspaceId: 'w1', workspace: { name: 'ACADEMY' } },
                    { templateId: 't2', templateVersion: null, workspaceId: 'w1', workspace: { name: 'ACADEMY' } },
                    { templateId: null, templateVersion: null, workspaceId: 'w1', workspace: { name: 'ACADEMY' } },
                ]),
            },
            organizationClub: { findMany: jest.fn() },
        }
        const out = await loadTemplateAdoptions(prisma as never, 'org1', ['t1', 't2'])
        // Russian collation: Cyrillic names before Latin ones.
        expect(out.get('t1')).toEqual([
            { clubId: 'w2', clubName: 'Беркут', version: 1 },
            { clubId: 'w1', clubName: 'ACADEMY', version: 2 },
        ])
        expect(out.get('t2')).toEqual([{ clubId: 'w1', clubName: 'ACADEMY', version: 1 }])
        expect(prisma.rankLadder.findMany.mock.calls[0][0].where).toEqual({
            templateId: { in: ['t1', 't2'] },
            workspace: {
                organizationLinks: { some: { organizationId: 'org1', status: 'ACTIVE' } },
            },
        })
    })

    it('reads nothing for no templates', async () => {
        const prisma = { rankLadder: { findMany: jest.fn() }, organizationClub: { findMany: jest.fn() } }
        await expect(loadTemplateAdoptions(prisma as never, 'org1', [])).resolves.toEqual(new Map())
        expect(prisma.rankLadder.findMany).not.toHaveBeenCalled()
    })
})
