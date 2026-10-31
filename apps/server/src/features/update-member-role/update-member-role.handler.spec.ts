import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    PlanLimitReachedError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { UpdateMemberRoleFeature } from './update-member-role.feature'
import { UpdateMemberRoleHandler } from './update-member-role.handler'

type RoleRow = { id: string; name: string; superuser: boolean }

const build = (
    opts: {
        role?: RoleRow | null
        currentRole?: string
        member?: boolean
        ownerId?: string
        status?: string
        limitReached?: boolean
    } = {},
) => {
    const prisma = {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                opts.member === false
                    ? null
                    : {
                          id: 'm1',
                          roleId: 'role-old',
                          status: opts.status ?? 'ACTIVE',
                          role: { name: opts.currentRole ?? 'user' },
                      },
            ),
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
            findUnique: jest.fn().mockResolvedValue({
                ownerId: opts.ownerId ?? 'owner-1',
                coachSeesAllGroups: false,
            }),
        },
    }
    // The real RbacService on the same prisma double, so the owner/role/super
    // admin decision under test is the production one.
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const billing = {
        assertWithinLimit: jest.fn(async () => {
            if (opts.limitReached) {
                throw new PlanLimitReachedError({
                    limit: 'coaches',
                    max: 2,
                    used: 2,
                    planName: 'Free',
                })
            }
        }),
    }
    const handler = new UpdateMemberRoleHandler(
        prisma as never,
        audit as never,
        realtime as never,
        new RbacService(prisma as never),
        billing as never,
    )
    return { handler, prisma, audit, billing }
}

const run = (
    handler: UpdateMemberRoleHandler,
    opts: {
        userId?: string
        invoker?: string
        roleName?: string | null
        isSuperAdmin?: boolean
    } = {},
) =>
    handler.execute(
        new UpdateMemberRoleFeature(
            { roleId: 'role-new' } as never,
            'w1',
            opts.userId ?? 'target',
            opts.invoker ?? 'admin-1',
            opts.roleName === undefined ? 'admin' : opts.roleName,
            opts.isSuperAdmin ?? false,
        ),
    )

const role = (name: string): RoleRow => ({
    id: 'role-new',
    name,
    superuser: false,
})

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

    it('skips the write when the role is unchanged', async () => {
        const { handler, prisma, audit } = build()
        prisma.workspaceMember.findFirst.mockResolvedValue({
            id: 'm1',
            roleId: 'role-new',
            role: { name: 'coach' },
        })
        await run(handler)
        expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it.each(['coach', 'user', null])(
        'refuses a %s caller (not a workspace admin)',
        async (roleName) => {
            const { handler, prisma } = build()
            await expect(run(handler, { roleName })).rejects.toThrow(
                ForbiddenError,
            )
            expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
        },
    )

    describe('role hierarchy', () => {
        it.each(['admin', 'head_coach'])(
            'refuses a head_coach granting %s',
            async (granted) => {
                const { handler, prisma } = build({ role: role(granted) })
                await expect(
                    run(handler, { roleName: 'head_coach' }),
                ).rejects.toThrow(ForbiddenError)
                expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
            },
        )

        it.each(['admin', 'head_coach'])(
            'refuses a head_coach demoting a member who is %s',
            async (current) => {
                const { handler, prisma } = build({
                    currentRole: current,
                    role: role('user'),
                })
                await expect(
                    run(handler, { roleName: 'head_coach' }),
                ).rejects.toThrow(ForbiddenError)
                expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
            },
        )

        it('lets a head_coach move a member between coach and student', async () => {
            const { handler, prisma } = build({
                currentRole: 'user',
                role: role('coach'),
            })
            await run(handler, { roleName: 'head_coach' })
            expect(prisma.workspaceMember.update).toHaveBeenCalled()
        })

        it('lets an admin grant admin', async () => {
            const { handler, prisma } = build({ role: role('admin') })
            await run(handler, { roleName: 'admin' })
            expect(prisma.workspaceMember.update).toHaveBeenCalled()
        })

        it('lets the owner grant head_coach even with a head_coach member row', async () => {
            const { handler, prisma } = build({ role: role('head_coach') })
            await run(handler, { invoker: 'owner-1', roleName: 'head_coach' })
            expect(prisma.workspaceMember.update).toHaveBeenCalled()
        })

        it('lets the platform super admin demote an admin', async () => {
            const { handler, prisma } = build({
                currentRole: 'admin',
                role: role('user'),
            })
            await run(handler, {
                invoker: 'root',
                roleName: 'super-admin',
                isSuperAdmin: true,
            })
            expect(prisma.workspaceMember.update).toHaveBeenCalled()
        })
    })

    it('refuses the retired moderator role', async () => {
        const { handler, prisma } = build({ role: role('moderator') })
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
            role: role('head_coach'),
        })
        await run(handler)
        expect(prisma.workspaceMember.update).toHaveBeenCalled()
    })

    it('refuses changing your own role', async () => {
        const { handler } = build()
        await expect(
            run(handler, { userId: 'me', invoker: 'me' }),
        ).rejects.toThrow(BadRequestError)
    })

    it('404s on an unknown role', async () => {
        const { handler } = build({ role: null })
        await expect(run(handler)).rejects.toThrow(NotFoundError)
    })

    it('404s on a non-member', async () => {
        const { handler } = build({ member: false })
        await expect(run(handler)).rejects.toThrow(NotFoundError)
    })

    describe('coach limit', () => {
        it('checks the coach limit when an active student becomes staff', async () => {
            const { handler, billing } = build()
            await run(handler)
            expect(billing.assertWithinLimit).toHaveBeenCalledWith(
                'w1',
                'coaches',
            )
        })

        it('refuses the promotion past the limit and changes nothing', async () => {
            const { handler, prisma, audit } = build({ limitReached: true })
            await expect(run(handler)).rejects.toBeInstanceOf(
                PlanLimitReachedError,
            )
            expect(prisma.workspaceMember.update).not.toHaveBeenCalled()
            expect(audit.record).not.toHaveBeenCalled()
        })

        it('does not check moves within staff, demotions or pending rows', async () => {
            for (const opts of [
                { currentRole: 'coach' },
                {
                    currentRole: 'coach',
                    role: { id: 'role-new', name: 'user', superuser: false },
                },
                { status: 'INVITED' },
            ]) {
                const { handler, billing } = build(opts)
                await run(handler)
                expect(billing.assertWithinLimit).not.toHaveBeenCalled()
            }
        })
    })
})
