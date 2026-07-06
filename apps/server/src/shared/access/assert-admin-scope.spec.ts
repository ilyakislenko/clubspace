import { ForbiddenError } from '../errors/shared.errors'
import { assertWorkspaceAdmin } from './assert-admin-scope'

const params = {
    userId: 'u1',
    workspaceId: 'w1',
    roleName: 'admin',
    isSuperAdmin: false,
}

const rbacWith = (canWrite: boolean, ctx: unknown = { scope: 'admin' }) => ({
    resolveCoachScope: jest.fn().mockResolvedValue(ctx),
    canWriteAllGroups: jest.fn().mockReturnValue(canWrite),
})

describe('assertWorkspaceAdmin', () => {
    it('resolves scope from the given params and returns the context', async () => {
        const ctx = { scope: 'admin', workspaceOwnerId: 'owner' }
        const rbac = rbacWith(true, ctx)

        const out = await assertWorkspaceAdmin(rbac as never, params)

        expect(rbac.resolveCoachScope).toHaveBeenCalledWith(params)
        expect(out).toBe(ctx)
    })

    it('throws Forbidden when the caller cannot write all groups', async () => {
        const rbac = rbacWith(false)
        await expect(
            assertWorkspaceAdmin(rbac as never, params),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('uses the caller-supplied message on rejection', async () => {
        const rbac = rbacWith(false)
        await expect(
            assertWorkspaceAdmin(rbac as never, params, 'Only owners'),
        ).rejects.toThrow('Only owners')
    })
})
