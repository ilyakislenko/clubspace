import { Reflector } from '@nestjs/core'

import { AuthGuard } from './auth.guard'

const role = (name: string, isWorkspaceOwner: boolean) => ({
    id: `role-${name}`,
    name,
    superuser: false,
    editable: false,
    features: [],
    isWorkspaceOwner,
})

const build = (memberRole: ReturnType<typeof role>) => {
    const adminRole = { ...role('admin', false), isWorkspaceOwner: undefined }
    const rolesService = {
        getRole: jest.fn().mockResolvedValue(memberRole),
        getRoleForWorkspaceOwner: jest.fn().mockResolvedValue(adminRole),
    }
    const guard = new AuthGuard(
        { verifyToken: jest.fn().mockResolvedValue({ sub: 'u1' }) } as never,
        new Reflector(),
        rolesService as never,
        {
            getUserById: jest
                .fn()
                .mockResolvedValue({ status: 'ACTIVE', isSuperAdmin: false }),
        } as never,
    )
    const req: Record<string, unknown> = {
        headers: { authorization: 'Bearer t' },
        params: { workspaceId: 'w1' },
        query: {},
    }
    const context = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => () => undefined,
        getClass: () => class {},
    }
    return { guard, rolesService, req, context }
}

describe('AuthGuard owner role resolution', () => {
    it('lifts an owner whose member row is a coach to the admin role', async () => {
        const { guard, rolesService, req, context } = build(
            role('coach', true),
        )
        await guard.canActivate(context as never)
        expect(rolesService.getRoleForWorkspaceOwner).toHaveBeenCalled()
        expect((req.user as { role: { name: string } }).role.name).toBe(
            'admin',
        )
    })

    it('keeps a non-owner coach as coach', async () => {
        const { guard, rolesService, req, context } = build(
            role('coach', false),
        )
        await guard.canActivate(context as never)
        expect(rolesService.getRoleForWorkspaceOwner).not.toHaveBeenCalled()
        expect((req.user as { role: { name: string } }).role.name).toBe(
            'coach',
        )
    })

    it('leaves an owner who is already head_coach alone', async () => {
        const { guard, rolesService, req, context } = build(
            role('head_coach', true),
        )
        await guard.canActivate(context as never)
        expect(rolesService.getRoleForWorkspaceOwner).not.toHaveBeenCalled()
        expect((req.user as { role: { name: string } }).role.name).toBe(
            'head_coach',
        )
    })
})
