import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { UpdatePlatformWorkspaceFeature } from './update-platform-workspace.feature'
import { UpdatePlatformWorkspaceHandler } from './update-platform-workspace.handler'

const UPDATED_ROW = {
    id: 'w1',
    key: 'bjj_school',
    name: 'BJJ School',
    type: 'GRAPPLING',
    isActive: true,
    timezone: 'Europe/Moscow',
    ownerId: 'owner-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { members: 4 },
}

type BuildOpts = {
    workspace?: { id: string; ownerId: string } | null
    newOwner?: { id: string; email: string } | null
    existingMembership?: { id: string; role: { name: string } } | null
}

const build = (opts: BuildOpts = {}) => {
    const tx = {
        user: {
            create: jest.fn().mockResolvedValue({
                id: 'u-new',
                email: 'new@club.ru',
                firstname: null,
                lastname: null,
            }),
        },
        role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-admin' }) },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(opts.existingMembership ?? null),
            create: jest.fn().mockResolvedValue({ id: 'm1' }),
            update: jest.fn().mockResolvedValue({ id: 'm1' }),
        },
        // Reflect what was written, the way Prisma does — a static row let
        // assertions about the *result* of an update pass vacuously.
        workspace: {
            update: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ ...UPDATED_ROW, ...data }),
            ),
        },
    }

    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.workspace === undefined
                        ? { id: 'w1', ownerId: 'owner-1' }
                        : opts.workspace,
                ),
        },
        user: {
            findUnique: jest.fn().mockImplementation((args: never) => {
                const where = (args as { where: { id?: string } }).where
                // Second lookup: resolving the owner for serialization.
                if (where.id) {
                    return Promise.resolve({
                        id: where.id,
                        email: 'owner@club.ru',
                        firstname: null,
                        lastname: null,
                    })
                }
                return Promise.resolve(opts.newOwner ?? null)
            }),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }

    const audit = { record: jest.fn().mockResolvedValue(undefined) }

    return {
        audit,
        handler: new UpdatePlatformWorkspaceHandler(prisma as never, audit as never),
        prisma,
        tx,
    }
}

const run = (
    handler: UpdatePlatformWorkspaceHandler,
    payload: Record<string, unknown>,
    isSuperAdmin = true,
) =>
    handler.execute(
        new UpdatePlatformWorkspaceFeature(
            'w1',
            payload as never,
            'platform-admin',
            isSuperAdmin,
        ),
    )

describe('UpdatePlatformWorkspaceHandler', () => {
    it('refuses a caller who is not a platform admin', async () => {
        const { handler, prisma } = build()
        await expect(
            run(handler, { name: 'X' }, false),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s for an unknown workspace', async () => {
        const { handler } = build({ workspace: null })
        await expect(run(handler, { name: 'X' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('updates only the fields that were sent', async () => {
        const { handler, tx } = build()
        await run(handler, { name: 'Новое имя' })
        expect(tx.workspace.update.mock.calls[0][0].data).toEqual({
            name: 'Новое имя',
        })
    })

    it('can flag the club inactive', async () => {
        const { handler, tx } = build()
        await run(handler, { isActive: false })
        expect(tx.workspace.update.mock.calls[0][0].data).toEqual({
            isActive: false,
        })
    })

    it('transfers ownership to an existing account', async () => {
        const { handler, tx } = build({
            newOwner: { id: 'u-existing', email: 'new@club.ru' },
        })
        const result = await run(handler, { ownerEmail: 'New@Club.ru' })
        expect(tx.workspace.update.mock.calls[0][0].data.ownerId).toBe(
            'u-existing',
        )
        expect(result.ownerTransferred).toBe(true)
        expect(result.ownerCreated).toBe(false)
    })

    it('creates the account when transferring to an unknown address', async () => {
        const { handler, tx } = build({ newOwner: null })
        const result = await run(handler, { ownerEmail: 'new@club.ru' })
        expect(tx.user.create).toHaveBeenCalled()
        expect(result.ownerCreated).toBe(true)
    })

    it('gives the new owner a membership row when they had none', async () => {
        const { handler, tx } = build({ newOwner: null })
        await run(handler, { ownerEmail: 'new@club.ru' })
        expect(tx.workspaceMember.create).toHaveBeenCalledWith({
            data: {
                userId: 'u-new',
                workspaceId: 'w1',
                roleId: 'role-admin',
                status: 'ACTIVE',
            },
        })
    })

    // The auth guard reads the role from the member row first, so an owner
    // still marked `coach` would be refused on every admin route.
    it('raises an existing coach to admin when promoting them to owner', async () => {
        const { handler, tx, audit } = build({
            newOwner: { id: 'u-coach', email: 'coach@club.ru' },
            existingMembership: { id: 'm-existing', role: { name: 'coach' } },
        })
        await run(handler, { ownerEmail: 'coach@club.ru' })
        const event = audit.record.mock.calls.find(
            (c: [{ action: string }]) =>
                c[0].action === 'workspace.transferOwner',
        )
        expect(event[0].metadata.previousRole).toBe('coach')
        expect(tx.workspaceMember.create).not.toHaveBeenCalled()
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm-existing' },
            data: { roleId: 'role-admin' },
        })
        expect(tx.workspace.update.mock.calls[0][0].data.ownerId).toBe(
            'u-coach',
        )
    })

    it('leaves an existing head_coach alone when promoting them to owner', async () => {
        const { handler, tx } = build({
            newOwner: { id: 'u-head', email: 'head@club.ru' },
            existingMembership: {
                id: 'm-existing',
                role: { name: 'head_coach' },
            },
        })
        await run(handler, { ownerEmail: 'head@club.ru' })
        expect(tx.workspaceMember.create).not.toHaveBeenCalled()
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(tx.workspace.update.mock.calls[0][0].data.ownerId).toBe(
            'u-head',
        )
    })

    it('audits only the fields that were actually sent', async () => {
        const { handler, audit } = build()
        await run(handler, { name: 'Новое имя' })
        const call = audit.record.mock.calls.find(
            (c: [{ action: string }]) => c[0].action === 'workspace.update',
        )
        expect(call[0].metadata).toEqual({ name: 'Новое имя' })
    })

    // A hand-over changes who controls the club — it is the event you go
    // looking for later, so it is recorded separately from a field edit.
    it('records the transfer as its own event, with both sides', async () => {
        const { handler, audit } = build({
            newOwner: { id: 'u-existing', email: 'new@club.ru' },
        })
        await run(handler, { ownerEmail: 'new@club.ru' })
        const call = audit.record.mock.calls.find(
            (c: [{ action: string }]) => c[0].action === 'workspace.transferOwner',
        )
        expect(call[0].metadata).toMatchObject({
            fromOwnerId: 'owner-1',
            toOwnerId: 'u-existing',
            toOwnerEmail: 'new@club.ru',
            ownerAccountCreated: false,
        })
    })

    it('writes no update event when nothing but the owner changed', async () => {
        const { handler, audit } = build({
            newOwner: { id: 'u-existing', email: 'new@club.ru' },
        })
        await run(handler, { ownerEmail: 'new@club.ru' })
        const actions = audit.record.mock.calls.map(
            (c: [{ action: string }]) => c[0].action,
        )
        expect(actions).toEqual(['workspace.transferOwner'])
    })

    it('does not audit a no-op owner re-submit', async () => {
        const { handler, audit } = build({
            newOwner: { id: 'owner-1', email: 'owner@club.ru' },
        })
        await run(handler, { ownerEmail: 'owner@club.ru' })
        const actions = audit.record.mock.calls.map(
            (c: [{ action: string }]) => c[0].action,
        )
        expect(actions).not.toContain('workspace.transferOwner')
    })

    // The console posts the whole form back, so the unchanged owner email
    // arrives on every save.
    it('treats re-sending the current owner as a no-op', async () => {
        const { handler, tx } = build({
            newOwner: { id: 'owner-1', email: 'owner@club.ru' },
        })
        const result = await run(handler, { ownerEmail: 'owner@club.ru' })
        expect(result.ownerTransferred).toBe(false)
        expect(tx.workspace.update.mock.calls[0][0].data.ownerId).toBeUndefined()
    })
})
