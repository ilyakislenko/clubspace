// UsersService drags in the auth stack (bcrypt/uuid etc.); we inject a mock, so
// stub the module to keep that chain from loading at import time.
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))

import {
    ForbiddenError,
    NotFoundError,
    PlanLimitReachedError,
} from '../../shared/errors/shared.errors'
import { ImportMembersFeature } from './import-members.feature'
import { ImportMembersHandler } from './import-members.handler'

type Row = { email: string; firstname?: string | null; lastname?: string | null }

const build = (opts: {
    existingEmails?: Record<string, string> // email -> userId
    activeMemberUserIds?: string[]
    invitedMemberUserIds?: string[]
    // Room left on the plan; undefined = unlimited.
    remaining?: number
    suspendedMemberUserIds?: string[]
    blockedAccountIds?: string[]
    denied?: boolean
    ws?: unknown
}) => {
    const suspended = new Set(opts.suspendedMemberUserIds ?? [])
    const blocked = new Set(opts.blockedAccountIds ?? [])
    const existing = opts.existingEmails ?? {}
    const active = new Set(opts.activeMemberUserIds ?? [])
    const invited = new Set(opts.invitedMemberUserIds ?? [])
    let created = 0

    const users = {
        getUserByEmail: jest.fn(async ({ email }: { email: string }) =>
            existing[email]
                ? {
                      id: existing[email],
                      status: blocked.has(existing[email]) ? 'BLOCKED' : 'ACTIVE',
                  }
                : null,
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
        workspace: {
            findUnique: jest.fn().mockResolvedValue(
                'ws' in opts ? opts.ws : { id: 'w1', name: 'Club', ownerId: 'owner' },
            ),
        },
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
                    if (suspended.has(uid))
                        return { id: `m-${uid}`, status: 'SUSPENDED' }
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
    const billing = {
        remaining: jest.fn().mockResolvedValue(
            opts.remaining === undefined
                ? { remaining: null, planName: 'Club', max: null, used: 0 }
                : {
                      remaining: opts.remaining,
                      planName: 'Free',
                      max: 30,
                      used: 30 - opts.remaining,
                  },
        ),
    }

    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'admin' }),
        canWriteAllGroups: jest.fn().mockReturnValue(!opts.denied),
    }
    const invitations = {
        invite: jest.fn().mockResolvedValue({ invitationId: 'inv', emailSent: false }),
    }

    const handler = new ImportMembersHandler(
        prisma as never,
        users as never,
        audit as never,
        { invalidate, joinWorkspaceRoom } as never,
        billing as never,
        rbac as never,
        invitations as never,
    )
    return {
        handler,
        users,
        userUpdate,
        memberCreate,
        memberUpdate,
        invalidate,
        joinWorkspaceRoom,
        invitations,
        audit,
        billing,
    }
}

const run = (handler: ImportMembersHandler, members: Row[]) =>
    handler.execute(
        new ImportMembersFeature({ members }, 'w1', 'admin1', 'admin', false),
    )

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
        expect(res).toEqual({ added: 1, invited: 0, skipped: 0, invalid: [] })
    })

    it('refuses a caller without workspace-admin scope', async () => {
        const t = build({ denied: true })
        await expect(run(t.handler, [{ email: 'a@x.com' }])).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(t.users.getUserByEmail).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const t = build({ ws: null })
        await expect(run(t.handler, [{ email: 'a@x.com' }])).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('invites an existing account instead of enrolling it, without e-mail', async () => {
        const t = build({ existingEmails: { 'a@x.com': 'u1' } })
        const res = await run(t.handler, [{ email: 'a@x.com', firstname: 'X' }])
        expect(t.users.createUser).not.toHaveBeenCalled()
        expect(t.memberCreate).not.toHaveBeenCalled()
        expect(t.userUpdate).not.toHaveBeenCalled()
        expect(t.invitations.invite).toHaveBeenCalledWith({
            workspace: { id: 'w1', name: 'Club', ownerId: 'owner' },
            user: { id: 'u1', email: 'a@x.com' },
            roleName: 'user',
            groupId: null,
            invitedById: 'admin1',
            sendEmail: false,
        })
        expect(res).toEqual({ added: 0, invited: 1, skipped: 0, invalid: [] })
        expect(t.audit.record.mock.calls[0][0].metadata).toEqual({
            added: 0,
            invited: 1,
            skipped: 0,
            invalid: 0,
        })
    })

    it('invites (does not reactivate) a suspended member', async () => {
        const t = build({
            existingEmails: { 'a@x.com': 'u1' },
            suspendedMemberUserIds: ['u1'],
        })
        const res = await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.memberUpdate).not.toHaveBeenCalled()
        expect(res.invited).toBe(1)
    })

    it('skips the owner and reports a blocked account', async () => {
        const t = build({
            existingEmails: { 'o@x.com': 'owner', 'b@x.com': 'u2' },
            blockedAccountIds: ['u2'],
        })
        const res = await run(t.handler, [{ email: 'o@x.com' }, { email: 'b@x.com' }])
        expect(res).toEqual({
            added: 0,
            invited: 0,
            skipped: 1,
            invalid: [{ email: 'b@x.com', reason: 'Аккаунт заблокирован' }],
        })
        expect(t.invitations.invite).not.toHaveBeenCalled()
    })

    it('skips an already-active member', async () => {
        const t = build({
            existingEmails: { 'a@x.com': 'u1' },
            activeMemberUserIds: ['u1'],
        })
        const res = await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.memberCreate).not.toHaveBeenCalled()
        expect(res).toEqual({ added: 0, invited: 0, skipped: 1, invalid: [] })
    })

    it('admits a person who applied (INVITED) without changing their role', async () => {
        const t = build({
            existingEmails: { 'a@x.com': 'u1' },
            invitedMemberUserIds: ['u1'],
        })
        const res = await run(t.handler, [{ email: 'a@x.com' }])
        expect(t.memberUpdate).toHaveBeenCalledWith({
            where: { id: 'm-u1' },
            data: { status: 'ACTIVE' },
        })
        expect(t.invitations.invite).not.toHaveBeenCalled()
        expect(res.added).toBe(1)
        expect(t.joinWorkspaceRoom).toHaveBeenCalledWith(['u1'], 'w1')
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

    describe('plan limits', () => {
        it('adds what fits and reports the rest without creating their accounts', async () => {
            const t = build({ remaining: 1 })
            const res = await run(t.handler, [
                { email: 'a@x.com' },
                { email: 'b@x.com' },
            ])
            expect(t.billing.remaining).toHaveBeenCalledWith('w1', 'members')
            expect(res.added).toBe(1)
            expect(res.invalid).toEqual([
                { email: 'b@x.com', reason: 'Лимит тарифа «Free»: 30 участников' },
            ])
            expect(t.users.createUser).toHaveBeenCalledTimes(1)
            expect(t.audit.record.mock.calls[0][0].metadata).toMatchObject({
                added: 1,
                limited: 1,
            })
        })

        it('still skips existing active members of a full club', async () => {
            const t = build({
                existingEmails: { 'a@x.com': 'u1' },
                activeMemberUserIds: ['u1'],
                remaining: 0,
            })
            const res = await run(t.handler, [{ email: 'a@x.com' }])
            expect(res).toEqual({ added: 0, skipped: 1, invalid: [] })
        })

        it('throws PLAN_LIMIT_REACHED when nothing fits', async () => {
            const t = build({ remaining: 0 })
            const err = await run(t.handler, [{ email: 'a@x.com' }]).catch(
                (e) => e,
            )
            expect(err).toBeInstanceOf(PlanLimitReachedError)
            expect(err.metadata).toEqual({
                limit: 'members',
                max: 30,
                used: 30,
                planName: 'Free',
            })
            expect(t.memberCreate).not.toHaveBeenCalled()
            expect(t.audit.record).not.toHaveBeenCalled()
        })
    })
})
