import { OrgRbacService } from '../../domains/organizations/org-access'
import { environment } from '../../environments/environment'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import {
    AddOrgMemberHandler,
    DEMO_ORG_MEMBER_MESSAGE,
    LAST_ORG_ADMIN_MESSAGE,
} from './add-org-member.handler'
import { CreateOrganizationLogoUploadFeature } from './create-organization-logo-upload.feature'
import { CreateOrganizationLogoUploadHandler } from './create-organization-logo-upload.handler'
import { GetOrganizationFeature } from './get-organization.feature'
import { GetOrganizationHandler } from './get-organization.handler'
import { InviteClubToOrganizationFeature } from './invite-club-to-organization.feature'
import { InviteClubToOrganizationHandler } from './invite-club-to-organization.handler'
import { ListMyOrganizationsFeature } from './list-my-organizations.feature'
import { ListMyOrganizationsHandler } from './list-my-organizations.handler'
import { ListOrgAuditEventsFeature } from './list-org-audit-events.feature'
import { ListOrgAuditEventsHandler } from './list-org-audit-events.handler'
import { ListOrgMembersHandler } from './list-org-members.handler'
import { ListOrganizationClubsFeature } from './list-organization-clubs.feature'
import { ListOrganizationClubsHandler } from './list-organization-clubs.handler'
import {
    AddOrgMemberFeature,
    ListOrgMembersFeature,
    RemoveOrgMemberFeature,
} from './org-members.feature'
import { RemoveClubFromOrganizationFeature } from './remove-club-from-organization.feature'
import { RemoveClubFromOrganizationHandler } from './remove-club-from-organization.handler'
import { RemoveOrgMemberHandler } from './remove-org-member.handler'
import { UpdateOrganizationFeature } from './update-organization.feature'
import { UpdateOrganizationHandler } from './update-organization.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const LINK = '22222222-2222-4222-8222-222222222222'

const ORG_ROW = {
    id: ORG,
    key: 'tomsk',
    name: 'Федерация',
    type: 'GRAPPLING',
    city: 'Томск',
    description: null,
    logoKey: null as string | null,
    timezone: 'Asia/Tomsk',
    isDemo: false,
    isActive: true,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
}

type Role = 'ORG_ADMIN' | 'ORG_COACH'

const clubLink = (status: 'INVITED' | 'ACTIVE' | 'LEFT', workspaceId = 'w1') => ({
    id: LINK,
    status,
    invitedAt: new Date('2026-11-20T00:00:00Z'),
    decidedAt: null,
    shareRegistry: true,
    shareMrr: false,
    shareRevenue30d: false,
    allowMemberAnnouncements: true,
    allowMemberEvents: true,
    workspace: {
        id: workspaceId,
        name: 'ACADEMY',
        city: 'Томск',
        logoKey: null,
        aboutContacts: [{ label: 'Админ', phone: '+7 900' }],
    },
})

const build = (role: Role | null = 'ORG_ADMIN') => {
    const prisma = {
        organization: {
            findUnique: jest.fn().mockResolvedValue(ORG_ROW),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...ORG_ROW, ...data })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        organizationMember: {
            findUnique: jest.fn().mockResolvedValue(role ? { role } : null),
            findUniqueOrThrow: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(2),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        organizationClub: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(clubLink('INVITED')),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ id: LINK }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workspaceJoinCode: { findUnique: jest.fn() },
        user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'new-user' }) },
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
    const orgRbac = new OrgRbacService(prisma as never)
    const audit = { record: jest.fn(), list: jest.fn() }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('bucket'),
        getPresignedGetUrl: jest.fn().mockResolvedValue('https://signed'),
        getPresignedPutUrl: jest.fn().mockResolvedValue({ url: 'https://s3/put', method: 'PUT' }),
        deleteObject: jest.fn(),
    }
    const notifier = { notifyClubInvited: jest.fn(), notifyMemberAdded: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const cache = {
        invalidate: jest.fn(),
        getOrCompute: jest.fn(async (_id: string, compute: () => Promise<unknown>) => ({
            computedAt: '2026-11-26T00:00:00.000Z',
            clubs: await compute(),
        })),
    }
    return { prisma, orgRbac, audit, files, notifier, realtime, cache }
}

const ME = 'me'

describe('org console handlers', () => {
    const saved = environment.organizations.enabled
    beforeEach(() => {
        environment.organizations.enabled = true
    })
    afterAll(() => {
        environment.organizations.enabled = saved
    })

    describe('getOrganization', () => {
        const run = (t: ReturnType<typeof build>) =>
            new GetOrganizationHandler(t.prisma as never, t.orgRbac, t.files as never).execute(
                new GetOrganizationFeature(ORG, ME, false),
            )

        it('returns the org with the caller’s role (org coach included)', async () => {
            await expect(run(build('ORG_COACH'))).resolves.toMatchObject({
                id: ORG,
                myRole: 'ORG_COACH',
                updatedAt: '2026-11-02T00:00:00.000Z',
            })
        })

        it('a club owner who is not org staff gets 404', async () => {
            await expect(run(build(null))).rejects.toBeInstanceOf(NotFoundError)
        })
    })

    describe('listMyOrganizations', () => {
        it('lists the caller’s own memberships of active orgs', async () => {
            const t = build()
            t.prisma.organizationMember.findMany.mockResolvedValue([
                { role: 'ORG_ADMIN', organization: { id: ORG, name: 'Ф', type: 'GRAPPLING', city: null, logoKey: null } },
            ])
            const out = await new ListMyOrganizationsHandler(t.prisma as never, t.files as never).execute(
                new ListMyOrganizationsFeature(ME),
            )
            expect(out.data).toEqual([
                { id: ORG, name: 'Ф', type: 'GRAPPLING', city: null, logoUrl: null, role: 'ORG_ADMIN' },
            ])
            expect(t.prisma.organizationMember.findMany.mock.calls[0][0].where).toEqual({
                userId: ME,
                organization: { isActive: true },
            })
        })

        it('404s while the hub is off', async () => {
            environment.organizations.enabled = false
            const t = build()
            await expect(
                new ListMyOrganizationsHandler(t.prisma as never, t.files as never).execute(
                    new ListMyOrganizationsFeature(ME),
                ),
            ).rejects.toBeInstanceOf(NotFoundError)
        })
    })

    describe('updateOrganization', () => {
        const payload = {
            name: 'Новое имя',
            city: 'Томск',
            description: null,
            logoKey: null,
            timezone: 'Asia/Tomsk',
        }
        const run = (t: ReturnType<typeof build>, p: Record<string, unknown> = payload) =>
            new UpdateOrganizationHandler(
                t.prisma as never,
                t.orgRbac,
                t.audit as never,
                t.files as never,
            ).execute(new UpdateOrganizationFeature(p as never, ORG, ME, false))

        it('refuses an org coach', async () => {
            await expect(run(build('ORG_COACH'))).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('saves the profile and audits org.update on the org journal', async () => {
            const t = build()
            const out = await run(t)
            expect(out.name).toBe('Новое имя')
            expect(t.audit.record).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'org.update', organizationId: ORG, workspaceId: null }),
            )
        })

        it('refuses a logo key this org did not issue', async () => {
            await expect(
                run(build(), { ...payload, logoKey: 'workspaces/w1/logo/11111111-1111-4111-8111-111111111111' }),
            ).rejects.toBeInstanceOf(BadRequestError)
        })

        it('a stale form is refused with 409 STALE_UPDATE', async () => {
            const t = build()
            t.prisma.organization.updateMany.mockResolvedValue({ count: 0 })
            await expect(
                run(t, { ...payload, expectedUpdatedAt: '2026-11-01T00:00:00.000Z' }),
            ).rejects.toBeInstanceOf(StaleUpdateError)
            expect(t.prisma.organization.update).not.toHaveBeenCalled()
        })

        it('deletes the replaced logo', async () => {
            const t = build()
            t.prisma.organization.findUnique.mockResolvedValue({ ...ORG_ROW, logoKey: 'organizations/old' })
            await run(t)
            expect(t.files.deleteObject).toHaveBeenCalledWith({ bucket: 'bucket', key: 'organizations/old' })
        })
    })

    describe('createOrganizationLogoUpload', () => {
        const run = (t: ReturnType<typeof build>) =>
            new CreateOrganizationLogoUploadHandler(t.orgRbac, t.files as never).execute(
                new CreateOrganizationLogoUploadFeature({ contentType: 'image/png', contentLength: 100 }, ORG, ME, false),
            )

        it('signs an upload under the org’s own prefix', async () => {
            const out = await run(build())
            expect(out.key).toMatch(new RegExp(`^organizations/${ORG}/logo/[0-9a-f-]{36}$`))
        })

        it('refuses an org coach', async () => {
            await expect(run(build('ORG_COACH'))).rejects.toBeInstanceOf(ForbiddenError)
        })
    })

    describe('listOrganizationClubs', () => {
        it('shows numbers for active clubs only and a totals row', async () => {
            const t = build('ORG_COACH')
            t.prisma.organizationClub.findMany.mockImplementation(async (args: { select: Record<string, unknown> }) =>
                'workspace' in args.select && 'aboutContacts' in (args.select.workspace as { select: object }).select
                    ? [clubLink('ACTIVE', 'w1'), { ...clubLink('INVITED', 'w2'), id: 'l2' }]
                    : [],
            )
            const metrics = {
                workspaceId: 'w1',
                students: 40,
                activeStudents: 30,
                attended30d: 20,
                new30d: 3,
                newcomerRetention3m: { rate: 0.5, eligible: 10 },
                mrr: null,
                revenue30d: null,
            }
            t.cache.getOrCompute.mockResolvedValue({ computedAt: '2026-11-26T00:00:00.000Z', clubs: [metrics] })
            const out = await new ListOrganizationClubsHandler(
                t.prisma as never,
                t.orgRbac,
                t.cache as never,
                t.files as never,
            ).execute(new ListOrganizationClubsFeature(ORG, ME, false))
            expect(out.data.map((r) => [r.status, r.metrics?.students ?? null])).toEqual([
                ['ACTIVE', 40],
                ['INVITED', null],
            ])
            expect(out.data[0].club.contacts).toEqual([{ label: 'Админ', phone: '+7 900' }])
            expect(out.totals).toMatchObject({ activeClubs: 1, students: 40, mrr: null })
        })

        it('money follows the live opt-in, not the cached snapshot', async () => {
            const t = build()
            t.prisma.organizationClub.findMany.mockImplementation(async (args: { select: Record<string, unknown> }) =>
                'workspace' in args.select && 'aboutContacts' in (args.select.workspace as { select: object }).select
                    ? [{ ...clubLink('ACTIVE', 'w1'), shareMrr: false, shareRevenue30d: true }]
                    : [],
            )
            // A snapshot written before the club turned MRR off.
            t.cache.getOrCompute.mockResolvedValue({
                computedAt: '2026-11-26T00:00:00.000Z',
                clubs: [
                    {
                        workspaceId: 'w1',
                        students: 1,
                        activeStudents: 1,
                        attended30d: 1,
                        new30d: 0,
                        newcomerRetention3m: { rate: null, eligible: 0 },
                        mrr: { amount: 9000, currency: 'RUB' },
                        revenue30d: { amount: 7000, currency: 'RUB' },
                    },
                ],
            })
            const out = await new ListOrganizationClubsHandler(
                t.prisma as never,
                t.orgRbac,
                t.cache as never,
                t.files as never,
            ).execute(new ListOrganizationClubsFeature(ORG, ME, false))
            expect(out.data[0].metrics).toMatchObject({ mrr: null, revenue30d: { amount: 7000, currency: 'RUB' } })
            expect(out.totals.mrr).toBeNull()
            expect(out.totals.revenue30d).toEqual({ amount: 7000, currency: 'RUB', clubs: 1 })
        })

        it('a stranger gets 404', async () => {
            const t = build(null)
            await expect(
                new ListOrganizationClubsHandler(t.prisma as never, t.orgRbac, t.cache as never, t.files as never).execute(
                    new ListOrganizationClubsFeature(ORG, ME, false),
                ),
            ).rejects.toBeInstanceOf(NotFoundError)
        })
    })

    describe('inviteClubToOrganization', () => {
        const run = (t: ReturnType<typeof build>, code = 'ABCD-2345') =>
            new InviteClubToOrganizationHandler(
                t.prisma as never,
                t.orgRbac,
                t.audit as never,
                t.notifier as never,
                t.realtime as never,
                t.files as never,
            ).execute(new InviteClubToOrganizationFeature({ joinCode: code }, ORG, ME, false))

        const withClub = (t: ReturnType<typeof build>) => {
            t.prisma.workspaceJoinCode.findUnique.mockResolvedValue({
                workspace: {
                    id: 'w1',
                    name: 'ACADEMY',
                    city: null,
                    logoKey: null,
                    aboutContacts: [],
                    ownerId: 'owner',
                    isActive: true,
                },
            })
            return t
        }

        it('refuses an org coach', async () => {
            await expect(run(withClub(build('ORG_COACH')))).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('an unknown code is 404', async () => {
            const t = build()
            t.prisma.workspaceJoinCode.findUnique.mockResolvedValue(null)
            await expect(run(t, 'NOPE1234')).rejects.toBeInstanceOf(NotFoundError)
        })

        it('a club already in the org is 409', async () => {
            const t = withClub(build())
            t.prisma.organizationClub.findUnique.mockResolvedValue({ id: LINK, status: 'ACTIVE' })
            await expect(run(t)).rejects.toBeInstanceOf(ConflictError)
        })

        it('a pending invite is not sent twice', async () => {
            const t = withClub(build())
            t.prisma.organizationClub.findUnique.mockResolvedValue({ id: LINK, status: 'INVITED' })
            await expect(run(t)).rejects.toBeInstanceOf(ConflictError)
        })

        it('creates the invitation, notifies the owner and shares nothing yet', async () => {
            const t = withClub(build())
            const out = await run(t)
            expect(t.prisma.organizationClub.create.mock.calls[0][0].data).toMatchObject({
                organizationId: ORG,
                workspaceId: 'w1',
                status: 'INVITED',
                shareMrr: false,
                shareRevenue30d: false,
            })
            expect(t.notifier.notifyClubInvited).toHaveBeenCalledWith(
                expect.objectContaining({ club: { workspaceId: 'w1', name: 'ACADEMY', ownerId: 'owner' } }),
            )
            expect(t.audit.record).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'org.inviteClub', workspaceId: null, organizationId: ORG }),
            )
            expect(out.metrics).toBeNull()
        })

        it('re-inviting a departed club reuses the row with fresh defaults', async () => {
            const t = withClub(build())
            t.prisma.organizationClub.findUnique.mockResolvedValue({ id: LINK, status: 'LEFT' })
            await run(t)
            expect(t.prisma.organizationClub.create).not.toHaveBeenCalled()
            const call = t.prisma.organizationClub.updateMany.mock.calls[0][0]
            expect(call.where).toEqual({ id: LINK, status: { in: ['DECLINED', 'LEFT', 'REMOVED'] } })
            expect(call.data).toMatchObject({ status: 'INVITED', shareMrr: false, decidedAt: null })
        })

        it('the demo federation cannot reach a real club (same 404 as an unknown code, no notice)', async () => {
            const t = withClub(build())
            t.prisma.organization.findUnique.mockResolvedValue({ ...ORG_ROW, isDemo: true })
            await expect(run(t)).rejects.toThrow('Клуб с таким кодом не найден')
            expect(t.prisma.organizationClub.create).not.toHaveBeenCalled()
            expect(t.notifier.notifyClubInvited).not.toHaveBeenCalled()
        })

        it('the demo federation may invite a demo club', async () => {
            const t = build()
            t.prisma.organization.findUnique.mockResolvedValue({ ...ORG_ROW, isDemo: true })
            t.prisma.workspaceJoinCode.findUnique.mockResolvedValue({
                workspace: { id: 'w9', name: 'Ритм', city: null, logoKey: null, aboutContacts: [], ownerId: 'o9', isActive: true, isDemo: true },
            })
            await run(t)
            expect(t.prisma.organizationClub.create).toHaveBeenCalled()
        })
    })

    describe('removeClubFromOrganization', () => {
        const run = (t: ReturnType<typeof build>) =>
            new RemoveClubFromOrganizationHandler(
                t.prisma as never,
                t.orgRbac,
                t.audit as never,
                t.cache as never,
                t.realtime as never,
            ).execute(new RemoveClubFromOrganizationFeature(ORG, LINK, ME, false))

        it('excludes the club and drops the cached numbers', async () => {
            const t = build()
            t.prisma.organizationClub.findFirst.mockResolvedValue(clubLink('ACTIVE'))
            await expect(run(t)).resolves.toEqual({ success: true })
            expect(t.prisma.organizationClub.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'REMOVED' })
            expect(t.cache.invalidate).toHaveBeenCalledWith(ORG)
        })

        it('refuses an org coach', async () => {
            await expect(run(build('ORG_COACH'))).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('a link of another org is 404', async () => {
            const t = build()
            t.prisma.organizationClub.findFirst.mockResolvedValue(null)
            await expect(run(t)).rejects.toBeInstanceOf(NotFoundError)
        })

        it('a club that already left is 409', async () => {
            const t = build()
            t.prisma.organizationClub.findFirst.mockResolvedValue(clubLink('LEFT'))
            t.prisma.organizationClub.updateMany.mockResolvedValue({ count: 0 })
            await expect(run(t)).rejects.toBeInstanceOf(ConflictError)
        })
    })

    describe('team', () => {
        const member = (userId: string, role: Role) => ({
            role,
            createdAt: new Date('2026-11-01T00:00:00Z'),
            user: { id: userId, email: `${userId}@x.ru`, firstname: 'Н', lastname: 'Б' },
        })

        it('listOrgMembers refuses an org coach and lists for an admin', async () => {
            const coach = build('ORG_COACH')
            await expect(
                new ListOrgMembersHandler(coach.prisma as never, coach.orgRbac).execute(
                    new ListOrgMembersFeature(ORG, ME, false),
                ),
            ).rejects.toBeInstanceOf(ForbiddenError)
            const t = build()
            t.prisma.organizationMember.findMany.mockResolvedValue([member('u1', 'ORG_ADMIN')])
            const out = await new ListOrgMembersHandler(t.prisma as never, t.orgRbac).execute(
                new ListOrgMembersFeature(ORG, ME, false),
            )
            expect(out.data).toEqual([
                { userId: 'u1', name: 'Н Б', email: 'u1@x.ru', role: 'ORG_ADMIN', createdAt: '2026-11-01T00:00:00.000Z' },
            ])
        })

        const add = (t: ReturnType<typeof build>, role: Role, email = 'New@X.ru') =>
            new AddOrgMemberHandler(t.prisma as never, t.orgRbac, t.audit as never, t.notifier as never).execute(
                new AddOrgMemberFeature({ email, role }, ORG, ME, false),
            )

        it('addOrgMember creates the account by e-mail and e-mails the newcomer', async () => {
            const t = build()
            t.prisma.organizationMember.findUnique
                .mockResolvedValueOnce({ role: 'ORG_ADMIN' }) // caller's scope
                .mockResolvedValueOnce(null) // not on the team yet
            t.prisma.organizationMember.findUniqueOrThrow.mockResolvedValue(member('new-user', 'ORG_COACH'))
            const out = await add(t, 'ORG_COACH')
            expect(t.prisma.user.create.mock.calls[0][0].data).toMatchObject({ email: 'new@x.ru' })
            expect(t.prisma.organizationMember.create.mock.calls[0][0].data).toMatchObject({
                organizationId: ORG,
                userId: 'new-user',
                role: 'ORG_COACH',
            })
            expect(t.notifier.notifyMemberAdded).toHaveBeenCalled()
            expect(out.role).toBe('ORG_COACH')
        })

        it('addOrgMember refuses to demote the last admin', async () => {
            const t = build()
            t.prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'ACTIVE' })
            t.prisma.organizationMember.findUnique
                .mockResolvedValueOnce({ role: 'ORG_ADMIN' })
                .mockResolvedValueOnce({ id: 'm1', role: 'ORG_ADMIN' })
            t.prisma.organizationMember.count.mockResolvedValue(1)
            await expect(add(t, 'ORG_COACH', 'u1@x.ru')).rejects.toThrow(LAST_ORG_ADMIN_MESSAGE)
            expect(t.prisma.organizationMember.update).not.toHaveBeenCalled()
        })

        it('addOrgMember refuses an org coach and a blocked account', async () => {
            await expect(add(build('ORG_COACH'), 'ORG_COACH')).rejects.toBeInstanceOf(ForbiddenError)
            const t = build()
            t.prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'BLOCKED' })
            await expect(add(t, 'ORG_COACH')).rejects.toBeInstanceOf(BadRequestError)
        })

        it('a demo federation takes only an existing demo account, without an e-mail', async () => {
            const stranger = build()
            stranger.prisma.organization.findUnique.mockResolvedValue({ ...ORG_ROW, isDemo: true })
            await expect(add(stranger, 'ORG_COACH', 'someone@real.ru')).rejects.toThrow(DEMO_ORG_MEMBER_MESSAGE)
            expect(stranger.prisma.user.create).not.toHaveBeenCalled()

            const real = build()
            real.prisma.organization.findUnique.mockResolvedValue({ ...ORG_ROW, isDemo: true })
            real.prisma.user.findUnique.mockResolvedValue({ id: 'u1', status: 'ACTIVE', isDemo: false })
            await expect(add(real, 'ORG_COACH', 'u1@x.ru')).rejects.toThrow(DEMO_ORG_MEMBER_MESSAGE)

            const demo = build()
            demo.prisma.organization.findUnique.mockResolvedValue({ ...ORG_ROW, isDemo: true })
            demo.prisma.user.findUnique.mockResolvedValue({ id: 'd1', status: 'ACTIVE', isDemo: true })
            demo.prisma.organizationMember.findUnique
                .mockResolvedValueOnce({ role: 'ORG_ADMIN' })
                .mockResolvedValueOnce(null)
            demo.prisma.organizationMember.findUniqueOrThrow.mockResolvedValue(member('d1', 'ORG_COACH'))
            await add(demo, 'ORG_COACH', 'coach@academy.demo')
            expect(demo.prisma.organizationMember.create).toHaveBeenCalled()
            expect(demo.prisma.user.create).not.toHaveBeenCalled()
            expect(demo.notifier.notifyMemberAdded).not.toHaveBeenCalled()
        })

        const remove = (t: ReturnType<typeof build>, userId = 'u1') =>
            new RemoveOrgMemberHandler(t.prisma as never, t.orgRbac, t.audit as never).execute(
                new RemoveOrgMemberFeature(ORG, userId, ME, false),
            )

        it('removeOrgMember keeps the last admin (400) and removes a coach', async () => {
            const last = build()
            last.prisma.organizationMember.findUnique
                .mockResolvedValueOnce({ role: 'ORG_ADMIN' })
                .mockResolvedValueOnce({ id: 'm1', role: 'ORG_ADMIN' })
            last.prisma.organizationMember.count.mockResolvedValue(1)
            await expect(remove(last)).rejects.toBeInstanceOf(BadRequestError)
            expect(last.prisma.organizationMember.delete).not.toHaveBeenCalled()

            const t = build()
            t.prisma.organizationMember.findUnique
                .mockResolvedValueOnce({ role: 'ORG_ADMIN' })
                .mockResolvedValueOnce({ id: 'm2', role: 'ORG_COACH' })
            await expect(remove(t)).resolves.toEqual({ success: true })
            expect(t.prisma.organizationMember.delete).toHaveBeenCalledWith({ where: { id: 'm2' } })
            expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'org.memberRemove' }))
        })

        it('removeOrgMember 404s for someone not on the team and refuses a coach', async () => {
            const t = build()
            t.prisma.organizationMember.findUnique.mockResolvedValueOnce({ role: 'ORG_ADMIN' }).mockResolvedValueOnce(null)
            await expect(remove(t)).rejects.toBeInstanceOf(NotFoundError)
            await expect(remove(build('ORG_COACH'))).rejects.toBeInstanceOf(ForbiddenError)
        })
    })

    describe('listOrgAuditEvents', () => {
        const run = (t: ReturnType<typeof build>) =>
            new ListOrgAuditEventsHandler(t.audit as never, t.orgRbac).execute(
                new ListOrgAuditEventsFeature({}, ORG, ME, false),
            )

        it('refuses an org coach', async () => {
            await expect(run(build('ORG_COACH'))).rejects.toBeInstanceOf(ForbiddenError)
        })

        it('reads the org journal and shows a club decision as the club, not its owner', async () => {
            const t = build()
            const base = {
                actorEmail: 'x@y.ru',
                targetType: 'organizationClub',
                targetId: LINK,
                targetLabel: null,
                createdAt: '2026-11-26T00:00:00.000Z',
            }
            t.audit.list.mockResolvedValue({
                data: [
                    { ...base, id: 'e1', workspaceId: null, actorId: ME, actorLabel: 'Я', action: 'org.inviteClub', metadata: { clubName: 'ACADEMY' } },
                    { ...base, id: 'e2', workspaceId: 'w1', actorId: 'owner', actorLabel: 'Иван (owner@a.ru)', action: 'org.acceptInvite', metadata: { clubName: 'ACADEMY' } },
                ],
                total: 2,
                curPage: 1,
                perPage: 50,
            })
            const out = await run(t)
            expect(t.audit.list).toHaveBeenCalledWith({
                workspaceId: null,
                organizationId: ORG,
                curPage: undefined,
                perPage: undefined,
            })
            expect(out.data[0].actorLabel).toBe('Я')
            expect(out.data[1]).toMatchObject({
                workspaceId: null,
                actorId: null,
                actorEmail: null,
                actorLabel: 'Клуб «ACADEMY»',
            })
        })
    })
})
