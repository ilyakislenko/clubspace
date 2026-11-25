jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true }, encryptionKey: 'test-secret' },
}))

import { personKeyFor } from '../../../domains/organizations/registry'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import { GetOrganizationRegistryPersonFeature } from './get-organization-registry-person.feature'
import { GetOrganizationRegistryPersonHandler } from './get-organization-registry-person.handler'
import { SearchOrganizationRegistryFeature } from './search-organization-registry.feature'
import { SearchOrganizationRegistryHandler } from './search-organization-registry.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const CLUB = '22222222-2222-4222-8222-222222222222'
const orgRbac = (member = true) => ({
    resolveOrgScope: jest.fn(async (c: object) => {
        if (!member) throw new NotFoundError({ message: 'Федерация не найдена' })
        return { ...c, role: 'ORG_COACH' }
    }),
})
const makePrisma = (org: unknown = { timezone: 'Asia/Tomsk' }) => ({
    organization: { findUnique: jest.fn().mockResolvedValue(org) },
    organizationClub: {
        findMany: jest
            .fn()
            .mockResolvedValue([{ workspaceId: CLUB, workspace: { name: 'ACADEMY', timezone: 'Asia/Tomsk' } }]),
    },
    consentRecord: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', dependentId: null }]) },
    guardianship: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([
        {
            userId: 'u1',
            workspaceId: CLUB,
            stripes: 0,
            awardedAt: new Date('2026-11-01T05:00:00Z'),
            firstname: 'Иван',
            lastname: 'Иванов',
            levelName: 'Синий пояс',
            levelColor: null,
            ladderName: 'Пояса',
            templateLevelName: null,
            total: 1,
        },
    ]),
})

describe('org registry handlers', () => {
    it('searches with paging defaults for any org staff', async () => {
        const out = await new SearchOrganizationRegistryHandler(makePrisma() as never, orgRbac() as never).execute(
            new SearchOrganizationRegistryFeature({ q: 'Иванов' }, ORG, 'u9', false),
        )
        expect(out).toMatchObject({ total: 1, curPage: 1, perPage: 50 })
        expect(out.data[0]).toMatchObject({
            personName: 'Иван Иванов',
            clubName: 'ACADEMY',
            awardedAt: '2026-11-01',
        })
    })

    it('answers 404 to a stranger and for a missing org', async () => {
        await expect(
            new SearchOrganizationRegistryHandler(makePrisma() as never, orgRbac(false) as never).execute(
                new SearchOrganizationRegistryFeature({}, ORG, 'u9', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(
            new SearchOrganizationRegistryHandler(makePrisma(null) as never, orgRbac() as never).execute(
                new SearchOrganizationRegistryFeature({}, ORG, 'u9', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('opens a person by key', async () => {
        const out = await new GetOrganizationRegistryPersonHandler(makePrisma() as never, orgRbac() as never).execute(
            new GetOrganizationRegistryPersonFeature(ORG, personKeyFor('test-secret', ORG, 'u1'), 'u9', false),
        )
        expect(out.personName).toBe('Иван Иванов')
        expect(out.history).toHaveLength(1)
    })
})
