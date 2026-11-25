import { Reflector } from '@nestjs/core'

import { OrgRbacService } from '../../domains/organizations/org-access'
import { environment } from '../../environments/environment'
import { ForbiddenError, NotFoundError } from '../errors/shared.errors'
import { OrganizationMemberGuard } from './organization-member.guard'
import { OrganizationsEnabledGuard } from './organizations-enabled.guard'

const ORG = '11111111-1111-4111-8111-111111111111'

const context = (user: unknown, organizationId = ORG) =>
    ({
        switchToHttp: () => ({ getRequest: () => ({ user, params: { organizationId } }) }),
        getHandler: () => () => undefined,
        getClass: () => class {},
    }) as never

const build = (p: { role: 'ORG_ADMIN' | 'ORG_COACH' | null; allowed?: string[] }) => {
    const prisma = {
        organization: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
        organizationMember: { findUnique: jest.fn().mockResolvedValue(p.role ? { role: p.role } : null) },
    }
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(p.allowed) } as unknown as Reflector
    return new OrganizationMemberGuard(reflector, new OrgRbacService(prisma as never))
}

const user = (over: Record<string, unknown> = {}) => ({ userId: 'u1', isSuperAdmin: false, ...over })

describe('OrganizationMemberGuard', () => {
    const saved = environment.organizations.enabled
    beforeEach(() => {
        environment.organizations.enabled = true
    })
    afterAll(() => {
        environment.organizations.enabled = saved
    })

    it('needs a signed-in user', async () => {
        await expect(build({ role: 'ORG_ADMIN' }).canActivate(context(undefined))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('a non-member (e.g. a club owner) gets 404', async () => {
        await expect(build({ role: null }).canActivate(context(user()))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('an org coach is refused on an ORG_ADMINS route and admitted on ORG_STAFF', async () => {
        await expect(
            build({ role: 'ORG_COACH', allowed: ['ORG_ADMIN'] }).canActivate(context(user())),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            build({ role: 'ORG_COACH', allowed: ['ORG_ADMIN', 'ORG_COACH'] }).canActivate(context(user())),
        ).resolves.toBe(true)
    })

    it('the platform admin passes as an org admin', async () => {
        await expect(
            build({ role: null, allowed: ['ORG_ADMIN'] }).canActivate(context(user({ isSuperAdmin: true }))),
        ).resolves.toBe(true)
    })

    it('everything is 404 while the hub is off', async () => {
        environment.organizations.enabled = false
        await expect(build({ role: 'ORG_ADMIN' }).canActivate(context(user()))).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(() => new OrganizationsEnabledGuard().canActivate()).toThrow(NotFoundError)
        environment.organizations.enabled = true
        expect(new OrganizationsEnabledGuard().canActivate()).toBe(true)
    })
})
