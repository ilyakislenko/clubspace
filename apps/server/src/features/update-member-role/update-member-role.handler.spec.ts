import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { UpdateMemberRoleFeature } from './update-member-role.feature'
import { UpdateMemberRoleHandler } from './update-member-role.handler'

type RoleRow = { id: string; name: string; superuser: boolean }

const build = (opts: { role?: RoleRow | null; ownerId?: string } = {}) => {
    const prisma = {
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue({ id: 'm1', roleId: 'role-old' }),
            update: jest.fn().mockResolvedValue({}),
        },
        role: {
            findUnique: jest.fn().mockResolvedValue(
                opts.role === undefined
                    ? { id: 'role-new', name: 'coach', superuser: false }
                    : opts.role,
            ),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: opts.ownerId ?? 'owner-1' }),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const handler = new UpdateMemberRoleHandler(
        prisma as never,
        audit as never,
        realtime as never,
    )
    return { handler, prisma, audit }
}

const run = (
    handler: UpdateMemberRoleHandler,
    userId = 'target',
    invoker = 'admin-1',
) =>
    handler.execute(
        new UpdateMemberRoleFeature(
            { roleId: 'role-new' } as never,
            'w1',
            userId,
            invoker,
        ),
    )

describe('UpdateMemberRoleHandler', () => {
    it('changes the role, audits it and returns the new role', async () => {
        const { handler, prisma, audit } = build()
        const out = await run(handler)
        expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { roleId: 'role-new' },
        })
        expect(audit.record).toHaveBeenCalled()
        expect(out).toEqual({
            userId: 'target',
            roleId: 'role-new',
            roleName: 'coach',
        })
    })

    it('refuses the retired moderator role', async () => {
        const { handler, prisma } = build({
            role: { id: 'role-new', name: 'moderator', superuser: false },
        })
        await expect(run(handler)).rejects.toThrow(BadRequestError)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
    })

    it('refuses a superuser role', async () => {
        const { handler, prisma } = build({
            role: { id: 'role-new', name: 'global admin', superuser: true },
        })
        await expect(run(handler)).rejects.toThrow(BadRequestError)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
    })

    it('refuses demoting the workspace owner below admin level', async () => {
        const { handler, prisma } = build({ ownerId: 'target' })
        await expect(run(handler)).rejects.toThrow(BadRequestError)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
    })

    it('lets the owner keep an admin-level role', async () => {
        const { handler, prisma } = build({
            ownerId: 'target',
            role: { id: 'role-new', name: 'head_coach', superuser: false },
        })
        await run(handler)
        expect(prisma.workspaceMember.update).toHaveBeenCalled()
    })

    it('refuses changing your own role', async () => {
        const { handler } = build()
        await expect(run(handler, 'me', 'me')).rejects.toThrow(BadRequestError)
    })

    it('404s on an unknown role', async () => {
        const { handler } = build({ role: null })
        await expect(run(handler)).rejects.toThrow(NotFoundError)
    })
})
