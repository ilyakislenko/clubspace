import { environment } from '../../environments/environment'
import {
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { AcceptOrganizationInviteHandler, OWNER_ONLY_ACCEPT } from './accept-organization-invite.handler'
import {
    AcceptOrganizationInviteFeature,
    DeclineOrganizationInviteFeature,
    LeaveOrganizationFeature,
    ListClubOrganizationsFeature,
    UpdateOrganizationSharingFeature,
} from './club-organizations.feature'
import { DeclineOrganizationInviteHandler } from './decline-organization-invite.handler'
import { LeaveOrganizationHandler } from './leave-organization.handler'
import { ListClubOrganizationsHandler } from './list-club-organizations.handler'
import { UpdateOrganizationSharingHandler } from './update-organization-sharing.handler'

const LINK = '22222222-2222-4222-8222-222222222222'

type Status = 'INVITED' | 'ACTIVE' | 'DECLINED' | 'LEFT' | 'REMOVED'

const linkRow = (status: Status, over: Record<string, unknown> = {}) => ({
    id: LINK,
    status,
    invitedAt: new Date('2026-11-20T10:00:00Z'),
    decidedAt: null,
    shareRegistry: true,
    shareMrr: false,
    shareRevenue30d: false,
    allowMemberAnnouncements: true,
    allowMemberEvents: true,
    organization: {
        id: 'org1',
        name: 'Федерация',
        type: 'GRAPPLING',
        city: 'Томск',
        description: null,
        logoKey: null,
    },
    ...over,
})

// The link store behaves like the table: updateMany applies `data` only when
// the status guard matches, and a later findFirst reads what was written.
const build = (status: Status | null) => {
    let row = status ? linkRow(status) : null
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: false }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'ACADEMY' }),
        },
        organizationClub: {
            findFirst: jest.fn(async () => row),
            findMany: jest.fn(async () => (row ? [row] : [])),
            updateMany: jest.fn(async (args: { where: { status: Status | { in: Status[] } }; data: Record<string, unknown> }) => {
                const want = args.where.status
                const ok = row && (typeof want === 'string' ? row.status === want : want.in.includes(row.status))
                if (!ok || !row) return { count: 0 }
                row = { ...row, ...args.data } as typeof row
                return { count: 1 }
            }),
        },
    }
    const audit = { record: jest.fn() }
    const cache = { invalidate: jest.fn() }
    const notifier = { notifyOrgAdmins: jest.fn() }
    const realtime = { invalidate: jest.fn() }
    const files = { getPresignedGetUrl: jest.fn(), getDefaultBucketName: jest.fn() }
    const rbac = new RbacService(prisma as never)
    return { prisma, audit, cache, notifier, realtime, files, rbac }
}

type Who = { userId: string; roleName: string | null; isSuperAdmin?: boolean }
const OWNER: Who = { userId: 'owner', roleName: 'admin' }
const ADMIN: Who = { userId: 'a1', roleName: 'admin' }

describe('club side of the federation hub', () => {
    const saved = environment.organizations.enabled
    beforeEach(() => {
        environment.organizations.enabled = true
    })
    afterAll(() => {
        environment.organizations.enabled = saved
    })

    describe('acceptOrganizationInvite', () => {
        const run = (t: ReturnType<typeof build>, who: Who, sharing?: Record<string, boolean>) =>
            new AcceptOrganizationInviteHandler(
                t.prisma as never,
                t.rbac,
                t.audit as never,
                t.cache as never,
                t.notifier as never,
                t.realtime as never,
                t.files as never,
            ).execute(
                new AcceptOrganizationInviteFeature(
                    { sharing },
                    'w1',
                    LINK,
                    who.userId,
                    who.roleName,
                    who.isSuperAdmin ?? false,
                ),
            )

        it.each(['head_coach', 'coach'])('refuses a %s (club admins only)', async (roleName) => {
            const t = build('INVITED')
            await expect(run(t, { userId: 'c1', roleName })).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('refuses a non-owner club admin: joining is the owner’s decision', async () => {
            const t = build('INVITED')
            await expect(run(t, ADMIN)).rejects.toThrow(OWNER_ONLY_ACCEPT)
            expect(t.prisma.organizationClub.updateMany).not.toHaveBeenCalled()
        })

        it('the owner accepts with the toggles the card showed', async () => {
            const t = build('INVITED')
            const out = await run(t, OWNER, { shareMrr: true, shareRegistry: false })
            expect(out.status).toBe('ACTIVE')
            expect(out.sharing).toMatchObject({ shareMrr: true, shareRegistry: false, shareRevenue30d: false })
            expect(t.prisma.organizationClub.updateMany.mock.calls[0][0].where).toEqual({
                id: LINK,
                workspaceId: 'w1',
                status: 'INVITED',
            })
            expect(t.cache.invalidate).toHaveBeenCalledWith('org1')
            expect(t.notifier.notifyOrgAdmins).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'org.club_joined', organizationId: 'org1' }),
            )
            expect(t.audit.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'org.acceptInvite',
                    workspaceId: 'w1',
                    organizationId: 'org1',
                }),
            )
            expect(t.realtime.invalidate).toHaveBeenCalledWith('w1', ['organizations'])
        })

        it('the platform admin may accept for the club', async () => {
            const t = build('INVITED')
            await expect(
                run(t, { userId: 'root', roleName: 'super-admin', isSuperAdmin: true }),
            ).resolves.toMatchObject({ status: 'ACTIVE' })
        })

        it.each(['ACTIVE', 'DECLINED', 'LEFT', 'REMOVED'] as Status[])(
            'a %s link is no longer acceptable (409)',
            async (status) => {
                const t = build(status)
                await expect(run(t, OWNER)).rejects.toBeInstanceOf(ConflictError)
            },
        )

        it('another club’s link is not found', async () => {
            const t = build(null)
            await expect(run(t, OWNER)).rejects.toBeInstanceOf(NotFoundError)
        })

        it('answers 404 while the hub is off', async () => {
            environment.organizations.enabled = false
            const t = build('INVITED')
            await expect(run(t, OWNER)).rejects.toBeInstanceOf(NotFoundError)
        })
    })

    describe('declineOrganizationInvite', () => {
        const run = (t: ReturnType<typeof build>, who: Who) =>
            new DeclineOrganizationInviteHandler(
                t.prisma as never,
                t.rbac,
                t.audit as never,
                t.realtime as never,
                t.files as never,
            ).execute(new DeclineOrganizationInviteFeature('w1', LINK, who.userId, who.roleName, false))

        it('any club admin may decline', async () => {
            const t = build('INVITED')
            const out = await run(t, ADMIN)
            expect(out.status).toBe('DECLINED')
            expect(out.canAccept).toBe(false)
            expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'org.declineInvite' }))
        })

        it('refuses a head coach', async () => {
            await expect(run(build('INVITED'), { userId: 'h', roleName: 'head_coach' })).rejects.toBeInstanceOf(
                ForbiddenError,
            )
        })

        it('an active membership cannot be declined (409)', async () => {
            await expect(run(build('ACTIVE'), OWNER)).rejects.toBeInstanceOf(ConflictError)
        })
    })

    describe('leaveOrganization', () => {
        const run = (t: ReturnType<typeof build>, who: Who) =>
            new LeaveOrganizationHandler(
                t.prisma as never,
                t.rbac,
                t.audit as never,
                t.cache as never,
                t.notifier as never,
                t.realtime as never,
                t.files as never,
            ).execute(new LeaveOrganizationFeature('w1', LINK, who.userId, who.roleName, false))

        it('any club admin leaves at any time; the org loses the numbers at once', async () => {
            const t = build('ACTIVE')
            const out = await run(t, ADMIN)
            expect(out.status).toBe('LEFT')
            expect(t.cache.invalidate).toHaveBeenCalledWith('org1')
            expect(t.notifier.notifyOrgAdmins).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'org.club_left' }),
            )
            expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'org.leave' }))
        })

        it('refuses a coach', async () => {
            await expect(run(build('ACTIVE'), { userId: 'c', roleName: 'coach' })).rejects.toBeInstanceOf(
                ForbiddenError,
            )
        })

        it('only an active membership can be left (409)', async () => {
            await expect(run(build('INVITED'), OWNER)).rejects.toBeInstanceOf(ConflictError)
        })
    })

    describe('updateOrganizationSharing', () => {
        const run = (t: ReturnType<typeof build>, who: Who, patch: Record<string, boolean>) =>
            new UpdateOrganizationSharingHandler(
                t.prisma as never,
                t.rbac,
                t.audit as never,
                t.cache as never,
                t.realtime as never,
                t.files as never,
            ).execute(new UpdateOrganizationSharingFeature(patch, 'w1', LINK, who.userId, who.roleName, false))

        it('writes the toggle, audits the change and drops the org’s cached numbers', async () => {
            const t = build('ACTIVE')
            const out = await run(t, ADMIN, { shareRevenue30d: true, shareRegistry: true })
            expect(out.sharing.shareRevenue30d).toBe(true)
            expect(t.audit.record).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'org.updateSharing',
                    metadata: expect.objectContaining({
                        clubName: 'ACADEMY',
                        changes: { shareRevenue30d: true },
                    }),
                }),
            )
            expect(t.cache.invalidate).toHaveBeenCalledWith('org1')
        })

        it('a no-op save writes no audit entry', async () => {
            const t = build('ACTIVE')
            await run(t, ADMIN, { shareRegistry: true })
            expect(t.audit.record).not.toHaveBeenCalled()
        })

        it('refuses a head coach (club data-sharing is a system setting)', async () => {
            await expect(
                run(build('ACTIVE'), { userId: 'h', roleName: 'head_coach' }, { shareMrr: true }),
            ).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('a pending invitation has no sharing to change yet (409)', async () => {
            await expect(run(build('INVITED'), OWNER, { shareMrr: true })).rejects.toBeInstanceOf(ConflictError)
        })
    })

    describe('listClubOrganizations', () => {
        const run = (t: ReturnType<typeof build>, who: Who) =>
            new ListClubOrganizationsHandler(t.prisma as never, t.rbac, t.files as never).execute(
                new ListClubOrganizationsFeature('w1', who.userId, who.roleName, false),
            )

        it('lists the club’s links but REMOVED, and tells the owner they may accept', async () => {
            const t = build('INVITED')
            const out = await run(t, OWNER)
            expect(out.data).toHaveLength(1)
            expect(out.data[0]).toMatchObject({ id: LINK, status: 'INVITED', canAccept: true })
            expect(t.prisma.organizationClub.findMany.mock.calls[0][0].where).toEqual({
                workspaceId: 'w1',
                status: { not: 'REMOVED' },
                organization: { isActive: true },
            })
        })

        it('a non-owner admin sees the card without «Принять»', async () => {
            const out = await run(build('INVITED'), ADMIN)
            expect(out.data[0].canAccept).toBe(false)
        })

        it('refuses a head coach', async () => {
            await expect(run(build('INVITED'), { userId: 'h', roleName: 'head_coach' })).rejects.toBeInstanceOf(
                ForbiddenError,
            )
        })
    })
})
