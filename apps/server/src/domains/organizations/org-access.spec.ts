import { environment } from '../../environments/environment'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import {
    activeClubIds,
    assertOrgAdmin,
    assertOrganizationsEnabled,
    assertOrgStaff,
    OrgRbacService,
} from './org-access'

const ORG = '11111111-1111-4111-8111-111111111111'

const build = (p: {
    org?: { isActive: boolean } | null
    member?: { role: 'ORG_ADMIN' | 'ORG_COACH' } | null
}) => {
    const prisma = {
        organization: {
            findUnique: jest.fn().mockResolvedValue(p.org === undefined ? { isActive: true } : p.org),
        },
        organizationMember: { findUnique: jest.fn().mockResolvedValue(p.member ?? null) },
    }
    return { prisma, orgRbac: new OrgRbacService(prisma as never) }
}

const caller = (over: Partial<{ userId: string; organizationId: string; isSuperAdmin: boolean }> = {}) => ({
    userId: 'u1',
    organizationId: ORG,
    isSuperAdmin: false,
    ...over,
})

describe('org access', () => {
    const saved = environment.organizations.enabled
    beforeEach(() => {
        environment.organizations.enabled = true
    })
    afterAll(() => {
        environment.organizations.enabled = saved
    })

    it('answers 404 for everything while ORGANIZATIONS_ENABLED is off', async () => {
        environment.organizations.enabled = false
        expect(() => assertOrganizationsEnabled()).toThrow(NotFoundError)
        const { orgRbac, prisma } = build({ member: { role: 'ORG_ADMIN' } })
        await expect(orgRbac.resolveOrgScope(caller())).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    })

    it('a stranger gets 404, not 403 (no existence leak)', async () => {
        const { orgRbac } = build({ member: null })
        await expect(orgRbac.resolveOrgScope(caller())).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a malformed id is 404 without a query', async () => {
        const { orgRbac, prisma } = build({ member: { role: 'ORG_ADMIN' } })
        await expect(
            orgRbac.resolveOrgScope(caller({ organizationId: 'mine' })),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.organization.findUnique).not.toHaveBeenCalled()
    })

    it('a switched-off org is closed to its staff', async () => {
        const { orgRbac } = build({ org: { isActive: false }, member: { role: 'ORG_ADMIN' } })
        await expect(orgRbac.resolveOrgScope(caller())).rejects.toBeInstanceOf(NotFoundError)
    })

    it('an unknown org is 404 even for the platform admin', async () => {
        const { orgRbac } = build({ org: null })
        await expect(
            orgRbac.resolveOrgScope(caller({ isSuperAdmin: true })),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('the platform admin acts as an org admin without a membership', async () => {
        const { orgRbac, prisma } = build({ member: null })
        const scope = await assertOrgAdmin(orgRbac, caller({ isSuperAdmin: true }))
        expect(scope.role).toBe('ORG_ADMIN')
        expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled()
    })

    it('an org coach is staff but not an admin', async () => {
        const { orgRbac } = build({ member: { role: 'ORG_COACH' } })
        await expect(assertOrgStaff(orgRbac, caller())).resolves.toMatchObject({ role: 'ORG_COACH' })
        await expect(assertOrgAdmin(orgRbac, caller())).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('an org admin passes both tiers', async () => {
        const { orgRbac, prisma } = build({ member: { role: 'ORG_ADMIN' } })
        await expect(assertOrgAdmin(orgRbac, caller())).resolves.toMatchObject({ role: 'ORG_ADMIN' })
        expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
            where: { organizationId_userId: { organizationId: ORG, userId: 'u1' } },
            select: { role: true },
        })
    })

    it('activeClubIds reads ACTIVE links only', async () => {
        const prisma = {
            organizationClub: {
                findMany: jest.fn().mockResolvedValue([{ workspaceId: 'w1' }, { workspaceId: 'w2' }]),
            },
        }
        await expect(activeClubIds(prisma as never, ORG)).resolves.toEqual(['w1', 'w2'])
        expect(prisma.organizationClub.findMany.mock.calls[0][0].where).toEqual({
            organizationId: ORG,
            status: 'ACTIVE',
        })
    })
})
