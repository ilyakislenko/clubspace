import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { CreatePlatformWorkspaceFeature } from './create-platform-workspace.feature'
import { CreatePlatformWorkspaceHandler } from './create-platform-workspace.handler'

const WORKSPACE_ROW = {
    id: 'w1',
    key: 'akademiya_bzhzh',
    name: 'Академия БЖЖ',
    type: 'GRAPPLING',
    isActive: true,
    timezone: 'Europe/Moscow',
    createdAt: new Date('2026-08-04T10:00:00.000Z'),
}

type BuildOpts = {
    existingUser?: { id: string; email: string } | null
    adminRole?: { id: string } | null
    keyTaken?: boolean
    siblingKeys?: string[]
}

const build = (opts: BuildOpts = {}) => {
    const tx = {
        user: {
            create: jest.fn().mockResolvedValue({
                id: 'u-new',
                email: 'coach@club.ru',
                firstname: null,
                lastname: null,
            }),
        },
        workspace: { create: jest.fn().mockResolvedValue(WORKSPACE_ROW) },
        workspaceMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    }

    const prisma = {
        role: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.adminRole === undefined
                        ? { id: 'role-admin' }
                        : opts.adminRole,
                ),
        },
        user: {
            findUnique: jest
                .fn()
                .mockResolvedValue(opts.existingUser ?? null),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(opts.keyTaken ? { id: 'other' } : null),
            findMany: jest
                .fn()
                .mockResolvedValue(
                    (opts.siblingKeys ?? []).map((key) => ({ key })),
                ),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }

    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new CreatePlatformWorkspaceHandler(prisma as never, audit as never)
    return { handler, prisma, tx, audit }
}

const run = (
    handler: CreatePlatformWorkspaceHandler,
    payload: Record<string, unknown> = {},
    isSuperAdmin = true,
) =>
    handler.execute(
        new CreatePlatformWorkspaceFeature(
            {
                name: 'Академия БЖЖ',
                type: 'GRAPPLING',
                ownerEmail: 'coach@club.ru',
                ...payload,
            } as never,
            'platform-admin',
            isSuperAdmin,
        ),
    )

describe('CreatePlatformWorkspaceHandler', () => {
    it('refuses a caller who is not a platform admin', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, {}, false)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('creates the owner account when the email is unknown', async () => {
        const { handler, tx } = build({ existingUser: null })
        const result = await run(handler)

        expect(tx.user.create).toHaveBeenCalled()
        expect(result.ownerCreated).toBe(true)
        // Email-OTP sign-in: a password here would be a credential nobody
        // was told about.
        expect(tx.user.create.mock.calls[0][0].data.password).toBeUndefined()
    })

    it('reuses an existing account and reports ownerCreated=false', async () => {
        const { handler, tx } = build({
            existingUser: { id: 'u-existing', email: 'coach@club.ru' },
        })
        const result = await run(handler)

        expect(tx.user.create).not.toHaveBeenCalled()
        expect(result.ownerCreated).toBe(false)
        expect(tx.workspace.create.mock.calls[0][0].data.ownerId).toBe(
            'u-existing',
        )
    })

    it('normalises the owner email before looking it up', async () => {
        const { handler, prisma } = build()
        await run(handler, { ownerEmail: '  Coach@Club.RU ' })
        expect(prisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { email: 'coach@club.ru' } }),
        )
    })

    // The owner also gets a membership row: RbacService bypasses membership
    // for owners, but get-my-workspaces reads memberships, so without it the
    // new owner signs in to an empty list.
    it('gives the owner an ACTIVE admin membership', async () => {
        const { handler, tx } = build()
        await run(handler)
        expect(tx.workspaceMember.create).toHaveBeenCalledWith({
            data: {
                userId: 'u-new',
                workspaceId: 'w1',
                roleId: 'role-admin',
                status: 'ACTIVE',
            },
        })
    })

    it('derives a latin key from a Cyrillic name', async () => {
        const { handler, tx } = build()
        await run(handler)
        expect(tx.workspace.create.mock.calls[0][0].data.key).toBe(
            'akademiya_bzhzh',
        )
    })

    it('suffixes a derived key past an existing club with the same name', async () => {
        const { handler, tx } = build({ siblingKeys: ['akademiya_bzhzh'] })
        await run(handler)
        expect(tx.workspace.create.mock.calls[0][0].data.key).toBe(
            'akademiya_bzhzh_2',
        )
    })

    it('rejects an explicit key that is already taken', async () => {
        const { handler, prisma } = build({ keyTaken: true })
        await expect(run(handler, { key: 'bjj_school' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects a malformed explicit key instead of silently fixing it', async () => {
        const { handler } = build()
        await expect(
            run(handler, { key: 'Not A Key' }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('asks for an explicit key when the name yields nothing usable', async () => {
        const { handler } = build()
        await expect(run(handler, { name: '…!!!' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('fails loudly when the admin role has not been seeded', async () => {
        const { handler, prisma } = build({ adminRole: null })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('omits timezone so the column default applies when none is given', async () => {
        const { handler, tx } = build()
        await run(handler)
        expect(tx.workspace.create.mock.calls[0][0].data.timezone).toBeUndefined()
    })

    it('passes an explicit timezone through', async () => {
        const { handler, tx } = build()
        await run(handler, { timezone: 'Asia/Almaty' })
        expect(tx.workspace.create.mock.calls[0][0].data.timezone).toBe(
            'Asia/Almaty',
        )
    })

    // Platform actions were invisible before this: nobody could tell who
    // created a club or when. Recorded against the new club, so it also shows
    // in that club's own journal.
    it('records a workspace.create audit event against the new club', async () => {
        const { handler, audit } = build()
        await run(handler)
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'workspace.create',
                targetType: 'workspace',
                workspaceId: 'w1',
                targetId: 'w1',
                actorId: 'platform-admin',
            }),
        )
        const meta = audit.record.mock.calls[0][0].metadata
        expect(meta).toMatchObject({
            key: 'akademiya_bzhzh',
            ownerEmail: 'coach@club.ru',
            ownerCreated: true,
        })
    })

    it('records ownerCreated=false when the account already existed', async () => {
        const { handler, audit } = build({
            existingUser: { id: 'u-existing', email: 'coach@club.ru' },
        })
        await run(handler)
        expect(audit.record.mock.calls[0][0].metadata.ownerCreated).toBe(false)
    })

    it('does not audit a refused creation', async () => {
        const { handler, audit } = build()
        await expect(run(handler, {}, false)).rejects.toThrow()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('serializes the created workspace', async () => {
        const { handler } = build()
        const result = await run(handler)
        expect(result.workspace).toEqual({
            workspaceId: 'w1',
            key: 'akademiya_bzhzh',
            name: 'Академия БЖЖ',
            type: 'GRAPPLING',
            isActive: true,
            timezone: 'Europe/Moscow',
            owner: {
                userId: 'u-new',
                email: 'coach@club.ru',
                firstname: null,
                lastname: null,
            },
            memberCount: 1,
            createdAt: '2026-08-04T10:00:00.000Z',
        })
    })
})
