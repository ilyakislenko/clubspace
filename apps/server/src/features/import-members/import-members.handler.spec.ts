// UsersService drags in the auth stack (bcrypt/uuid etc.); we inject a mock, so
// stub the module to keep that chain from loading at import time.
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))

import { ImportMembersFeature } from './import-members.feature'
import { ImportMembersHandler } from './import-members.handler'

type Row = { email: string; firstname?: string | null; lastname?: string | null }

const build = (opts: {
    existingEmails?: Record<string, string> // email -> userId
    activeMemberUserIds?: string[]
    invitedMemberUserIds?: string[]
}) => {
    const existing = opts.existingEmails ?? {}
    const active = new Set(opts.activeMemberUserIds ?? [])
    const invited = new Set(opts.invitedMemberUserIds ?? [])
    let created = 0

    const users = {
        getUserByEmail: jest.fn(async ({ email }: { email: string }) =>
            existing[email] ? { id: existing[email] } : null,
        ),
        createUser: jest.fn(async () => {
            created += 1
            return { id: `new-${created}` }
        }),
    }
    const userUpdate = jest.fn().mockResolvedValue({})
    const memberCreate = jest.fn().mockResolvedValue({})
    const memberUpdate = jest.fn().mockResolvedValue({})
    const prisma = {
        role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-user' }) },
        user: { update: userUpdate },
        workspaceMember: {
            findUnique: jest.fn(
                async ({
                    where,
                }: {
                    where: { userId_workspaceId: { userId: string } }
                }) => {
                    const uid = where.userId_workspaceId.userId
                    if (active.has(uid)) return { id: `m-${uid}`, status: 'ACTIVE' }
                    if (invited.has(uid))
                        return { id: `m-${uid}`, status: 'INVITED' }
                    return null
                },
            ),
            create: memberCreate,
            update: memberUpdate,
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const invalidate = jest.fn()
    const joinWorkspaceRoom = jest.fn()

    const handler = new ImportMembersHandler(
        prisma as never,
        users as never,
        audit as never,
        { invalidate, joinWorkspaceRoom } as never,
    )
    return {
        handler,
        users,
        userUpdate,
        memberCreate,
        memberUpdate,
        invalidate,
        joinWorkspaceRoom,
    }
}

const run = (handler: ImportMembersHandler, members: Row[]) =>
    handler.execute(new ImportMembersFeature({ members }, 'w1', 'admin1'))

describe('importMembers', () => {
    it('creates a user + member for a new email', async () => {
        const t = build({})
        const res = await run(t.handler, [
            { email: 'New@X.com', firstname: 'Иван', lastname: 'П' },
        ])
        expect(t.users.createUser).toHaveBeenCalledWith({ email: 'new@x.com' })
        expect(t.userUpdate).toHaveBeenCalledWith({
            where: { id: 'new-1' },
            data: { firstname: 'Иван', lastname: 'П' },
        })
        expect(t.memberCreate).toHaveBeenCalled()
        expect(res).toEqual({ added: 1, skipped: 0, invalid: [] })
    })

    it('adds an existing user who is not yet a member', async () => {
        const t = build({ existingEmails: { 'a@x.com': 'u1' } })
        const res = await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.users.createUser).not.toHaveBeenCalled()
        expect(t.memberCreate).toHaveBeenCalled()
        expect(res.added).toBe(1)
    })

    it('skips an already-active member', async () => {
        const t = build({
            existingEmails: { 'a@x.com': 'u1' },
            activeMemberUserIds: ['u1'],
        })
        const res = await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.memberCreate).not.toHaveBeenCalled()
        expect(res).toEqual({ added: 0, skipped: 1, invalid: [] })
    })

    it('re-activates an invited member', async () => {
        const t = build({
            existingEmails: { 'a@x.com': 'u1' },
            invitedMemberUserIds: ['u1'],
        })
        const res = await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.memberUpdate).toHaveBeenCalled()
        expect(res.added).toBe(1)
    })

    it('reports invalid emails and in-file duplicates', async () => {
        const t = build({})
        const res = await run(t.handler, [
            { email: 'not-an-email' },
            { email: 'dup@x.com' },
            { email: 'DUP@x.com' },
        ])
        expect(res.added).toBe(1)
        expect(res.invalid).toEqual([
            { email: 'not-an-email', reason: 'Некорректный email' },
            { email: 'dup@x.com', reason: 'Дубликат в файле' },
        ])
    })

    it('invalidates the members list only when something was added', async () => {
        const t = build({
            existingEmails: { 'a@x.com': 'u1' },
            activeMemberUserIds: ['u1'],
        })
        await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.invalidate).not.toHaveBeenCalled()
        expect(t.joinWorkspaceRoom).not.toHaveBeenCalled()
    })
})
