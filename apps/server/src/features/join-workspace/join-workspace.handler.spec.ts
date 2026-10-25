import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { JoinWorkspaceFeature } from './join-workspace.feature'
import { JoinWorkspaceHandler } from './join-workspace.handler'

const WS = {
    id: 'w1',
    name: 'Club',
    ownerId: 'owner',
    isActive: true,
    joinAutoApprove: false,
}

const build = (
    opts: {
        ws?: unknown
        user?: unknown
        existing?: unknown
        outcome?: unknown
    } = {},
) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in opts ? opts.ws : WS),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue(
                'user' in opts
                    ? opts.user
                    : { firstname: 'Ann', lastname: 'Lee' },
            ),
            update: jest.fn().mockResolvedValue({}),
        },
    }
    const joinRequests = {
        findExisting: jest.fn().mockResolvedValue(opts.existing ?? null),
        requestMembership: jest.fn().mockResolvedValue(
            opts.outcome ?? {
                kind: 'created',
                status: 'INVITED',
                membershipId: 'm1',
            },
        ),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new JoinWorkspaceHandler(
        prisma as never,
        joinRequests as never,
        audit as never,
    )
    return { handler, prisma, joinRequests, audit }
}

const run = (
    handler: JoinWorkspaceHandler,
    payload: Record<string, unknown> = { code: 'abcd-2345' },
) => handler.execute(new JoinWorkspaceFeature(payload as never, 'u1'))

const NOT_FOUND = 'Клуб с таким кодом не найден'

describe('joinWorkspace — code lookup', () => {
    it('looks the club up by the normalized code', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.workspace.findUnique.mock.calls[0][0].where).toEqual({
            joinCode: 'ABCD2345',
        })
    })

    it('404s on a malformed code without querying the database', async () => {
        const { handler, prisma, joinRequests } = build()
        for (const code of ['ABCD', 'ABCD-23O5', '!!!!-!!!!', 'ABCD-23456']) {
            await expect(run(handler, { code })).rejects.toThrow(NOT_FOUND)
        }
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('404s on an unknown code', async () => {
        const { handler } = build({ ws: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(handler)).rejects.toThrow(NOT_FOUND)
    })

    it('404s on an inactive club exactly like an unknown code', async () => {
        const { handler, joinRequests } = build({
            ws: { ...WS, isActive: false },
        })
        await expect(run(handler)).rejects.toThrow(NOT_FOUND)
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })
})

describe('joinWorkspace — existing relationship', () => {
    it.each([
        [{ kind: 'owner' }, 'active'],
        [{ kind: 'existing', status: 'ACTIVE', membershipId: 'm' }, 'active'],
        [{ kind: 'existing', status: 'INVITED', membershipId: 'm' }, 'pending'],
        [{ kind: 'existing', status: 'BLOCKED', membershipId: 'm' }, 'rejected'],
        [
            { kind: 'existing', status: 'SUSPENDED', membershipId: 'm' },
            'rejected',
        ],
    ])('answers %j with %s and creates nothing', async (existing, status) => {
        const { handler, prisma, joinRequests, audit } = build({ existing })
        await expect(run(handler)).resolves.toEqual({
            status,
            created: false,
            workspaceId: 'w1',
            workspaceName: 'Club',
        })
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('does not ask an existing member for a name', async () => {
        const { handler } = build({
            existing: { kind: 'existing', status: 'INVITED', membershipId: 'm' },
            user: { firstname: null, lastname: null },
        })
        await expect(run(handler)).resolves.toMatchObject({ status: 'pending' })
    })
})

describe('joinWorkspace — names', () => {
    it('400s when the user has no name and the payload gives none', async () => {
        const { handler, joinRequests } = build({
            user: { firstname: null, lastname: null },
        })
        const err = await run(handler).catch((e) => e)
        expect(err).toBeInstanceOf(BadRequestError)
        expect(err.message).toBe(
            'Укажите имя и фамилию — так клуб поймёт, кто подаёт заявку',
        )
        expect(joinRequests.requestMembership).not.toHaveBeenCalled()
    })

    it('400s when only one of the two names is given', async () => {
        const { handler } = build({ user: { firstname: ' ', lastname: null } })
        await expect(
            run(handler, { code: 'ABCD2345', firstname: 'Ann' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        await expect(
            run(handler, { code: 'ABCD2345', lastname: 'Lee' }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('stores both names for a nameless user and then joins', async () => {
        const { handler, prisma, joinRequests } = build({
            user: { firstname: null, lastname: null },
        })
        await run(handler, {
            code: 'ABCD2345',
            firstname: 'Ann',
            lastname: 'Lee',
        })
        expect(prisma.user.update.mock.calls[0][0]).toEqual({
            where: { id: 'u1' },
            data: { firstname: 'Ann', lastname: 'Lee' },
        })
        expect(joinRequests.requestMembership).toHaveBeenCalledTimes(1)
    })

    it('never overwrites a name the user already has', async () => {
        const { handler, prisma } = build({
            user: { firstname: 'Real', lastname: 'Person' },
        })
        await run(handler, {
            code: 'ABCD2345',
            firstname: 'Other',
            lastname: 'Name',
        })
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('fills only the blank half', async () => {
        const { handler, prisma } = build({
            user: { firstname: 'Real', lastname: null },
        })
        await run(handler, {
            code: 'ABCD2345',
            firstname: 'Other',
            lastname: 'Lee',
        })
        expect(prisma.user.update.mock.calls[0][0].data).toEqual({
            lastname: 'Lee',
        })
    })
})

describe('joinWorkspace — creating the request', () => {
    it('files a pending request, audits it, and passes the club setting', async () => {
        const { handler, joinRequests, audit } = build()
        await expect(run(handler)).resolves.toEqual({
            status: 'pending',
            created: true,
            workspaceId: 'w1',
            workspaceName: 'Club',
        })
        expect(joinRequests.requestMembership).toHaveBeenCalledWith({
            userId: 'u1',
            workspace: WS,
            autoApprove: false,
        })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.joinByCode',
            targetType: 'member',
            targetId: 'u1',
            workspaceId: 'w1',
            actorId: 'u1',
            metadata: { autoApproved: false },
        })
    })

    it('joins straight away when the club auto-approves', async () => {
        const { handler, joinRequests, audit } = build({
            ws: { ...WS, joinAutoApprove: true },
            outcome: { kind: 'created', status: 'ACTIVE', membershipId: 'm1' },
        })
        await expect(run(handler)).resolves.toMatchObject({
            status: 'active',
            created: true,
        })
        expect(joinRequests.requestMembership.mock.calls[0][0].autoApprove).toBe(
            true,
        )
        expect(audit.record.mock.calls[0][0].metadata).toEqual({
            autoApproved: true,
        })
    })

    it('reports a request that lost the race as existing, without auditing', async () => {
        const { handler, audit } = build({
            outcome: { kind: 'existing', status: 'INVITED', membershipId: 'm1' },
        })
        await expect(run(handler)).resolves.toMatchObject({
            status: 'pending',
            created: false,
        })
        expect(audit.record).not.toHaveBeenCalled()
    })
})
