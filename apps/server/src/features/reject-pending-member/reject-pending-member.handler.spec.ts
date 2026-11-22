import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RejectPendingMemberFeature } from './reject-pending-member.feature'
import { RejectPendingMemberHandler } from './reject-pending-member.handler'

const OWNER = 'owner1'

const make = (
    opts: {
        count?: number
        pending?: { id: string; role: string } | null
        invoker?: string
        roleName?: string | null
        scope?: 'admin' | 'coach_own_only'
    } = {},
) => {
    const pending =
        opts.pending === undefined ? { id: 'm9', role: 'user' } : opts.pending
    const prisma = {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                pending && {
                    id: pending.id,
                    role: { name: pending.role },
                    workspace: { name: 'Клуб' },
                },
            ),
            updateMany: jest.fn().mockResolvedValue({ count: opts.count ?? 1 }),
        },
        // The club's words for a refusal (loadClubVocabulary).
        workspace: { findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }) },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const invoker = opts.invoker ?? OWNER
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({
            scope: opts.scope ?? 'admin',
            userId: invoker,
            workspaceId: 'w1',
            workspaceOwnerId: OWNER,
        }),
        canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
        clubVocabulary: jest.fn(),
    }
    const joinRequests = { notifyDeclined: jest.fn().mockResolvedValue(undefined) }
    const handler = new RejectPendingMemberHandler(
        prisma as never,
        audit as never,
        realtime as never,
        rbac as never,
        joinRequests as never,
    )
    const run = (payload: { comment?: string } = {}) =>
        handler.execute(
            new RejectPendingMemberFeature(
                payload,
                'w1',
                'u2',
                invoker,
                opts.roleName === undefined ? null : opts.roleName,
                false,
            ),
        )
    return { prisma, audit, realtime, joinRequests, run }
}

describe('RejectPendingMemberHandler', () => {
    it('blocks only INVITED rows, audits, invalidates and tells the applicant', async () => {
        const { prisma, audit, realtime, joinRequests, run } = make()
        await expect(run({ comment: 'Набор закрыт' })).resolves.toEqual({
            status: 'rejected',
        })
        expect(prisma.workspaceMember.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'u2',
            status: 'INVITED',
        })
        expect(prisma.workspaceMember.updateMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u2', status: 'INVITED' },
            data: { status: 'BLOCKED' },
        })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.rejectPending',
            targetType: 'member',
            targetId: 'u2',
            workspaceId: 'w1',
            actorId: OWNER,
            metadata: { comment: 'Набор закрыт' },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['members', 'requests'])
        expect(joinRequests.notifyDeclined).toHaveBeenCalledWith({
            userId: 'u2',
            workspaceId: 'w1',
            workspaceName: 'Клуб',
            membershipId: 'm9',
            comment: 'Набор закрыт',
        })
    })

    it('rejects without a body (the app sends none): no comment anywhere', async () => {
        const { audit, joinRequests, run } = make()
        await run()
        expect(audit.record.mock.calls[0][0].metadata).toEqual({ comment: null })
        expect(joinRequests.notifyDeclined.mock.calls[0][0].comment).toBeNull()
    })

    it('treats a blank comment as none', async () => {
        const { joinRequests, run } = make()
        await run({ comment: '' })
        expect(joinRequests.notifyDeclined.mock.calls[0][0].comment).toBeNull()
    })

    it('404s when there is no pending row (decided already, or not INVITED)', async () => {
        const { prisma, audit, realtime, joinRequests, run } = make({ pending: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.workspaceMember.updateMany).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
        expect(joinRequests.notifyDeclined).not.toHaveBeenCalled()
    })

    it('404s when a second staff member decided in between', async () => {
        const { audit, realtime, joinRequests, run } = make({ count: 0 })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
        expect(joinRequests.notifyDeclined).not.toHaveBeenCalled()
    })

    it('refuses a coach (no sport-lead scope)', async () => {
        const { prisma, run } = make({
            invoker: 'c1',
            roleName: 'coach',
            scope: 'coach_own_only',
        })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled()
    })

    it.each(['coach', 'head_coach', 'admin'])(
        'refuses a head coach rejecting a pending %s',
        async (role) => {
            const { prisma, run } = make({
                invoker: 'hc1',
                roleName: 'head_coach',
                pending: { id: 'm9', role },
            })
            await expect(run()).rejects.toThrow(
                /может только владелец или администратор клуба/,
            )
            expect(prisma.workspaceMember.updateMany).not.toHaveBeenCalled()
        },
    )

    it('lets a head coach reject a pending student', async () => {
        const { prisma, run } = make({ invoker: 'hc1', roleName: 'head_coach' })
        await expect(run()).resolves.toEqual({ status: 'rejected' })
        expect(prisma.workspaceMember.updateMany).toHaveBeenCalled()
    })

    it('lets an admin reject a pending coach', async () => {
        const { prisma, run } = make({
            invoker: 'a1',
            roleName: 'admin',
            pending: { id: 'm9', role: 'coach' },
        })
        await expect(run()).resolves.toEqual({ status: 'rejected' })
        expect(prisma.workspaceMember.updateMany).toHaveBeenCalled()
    })

    it('lets the owner (no member row, role null) reject a pending coach', async () => {
        const { run } = make({ pending: { id: 'm9', role: 'coach' } })
        await expect(run()).resolves.toEqual({ status: 'rejected' })
    })
})
