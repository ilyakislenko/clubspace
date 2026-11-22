import { ForbiddenError } from '../errors/shared.errors'
import { RbacService } from '../services/rbac.service'
import { assertClubAdmin, assertSportLead } from './assert-admin-scope'

// A real RbacService over a one-club fake: the tiers are decided by role name,
// ownership and the super-admin flag, not by a mocked scope.
const rbac = () =>
    new RbacService({
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: true }),
        },
    } as never)

const caller = (
    userId: string,
    roleName: string | null,
    isSuperAdmin = false,
) => ({ userId, workspaceId: 'w1', roleName, isSuperAdmin })

describe('assertClubAdmin', () => {
    it.each([
        ['the owner (resolved to admin)', caller('owner', 'admin')],
        ['the owner with a lower member row', caller('owner', 'head_coach')],
        ['an admin', caller('u1', 'admin')],
        ['the platform super admin', caller('su', null, true)],
    ])('passes %s and returns the context', async (_, params) => {
        const ctx = await assertClubAdmin(rbac(), params)
        expect(ctx).toMatchObject({ userId: params.userId, workspaceOwnerId: 'owner' })
    })

    it.each([
        ['a head coach', 'head_coach'],
        ['a coach', 'coach'],
    ])('refuses %s', async (_, role) => {
        await expect(assertClubAdmin(rbac(), caller('u1', role))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('uses the caller-supplied message on rejection', async () => {
        await expect(
            assertClubAdmin(rbac(), caller('u1', 'head_coach'), 'Только администратор'),
        ).rejects.toThrow('Только администратор')
    })
})

describe('assertSportLead', () => {
    it.each([
        ['the owner', caller('owner', 'admin')],
        ['an admin', caller('u1', 'admin')],
        ['a head coach', caller('u1', 'head_coach')],
        ['the platform super admin', caller('su', null, true)],
    ])('passes %s', async (_, params) => {
        await expect(assertSportLead(rbac(), params)).resolves.toMatchObject({
            scope: 'admin',
        })
    })

    it('refuses a coach with the caller-supplied message', async () => {
        await expect(
            assertSportLead(rbac(), caller('u1', 'coach'), 'Только руководство'),
        ).rejects.toThrow('Только руководство')
    })
})
