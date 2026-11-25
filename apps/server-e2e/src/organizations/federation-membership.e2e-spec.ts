import * as fs from 'fs'
import * as path from 'path'

import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { addOrgStaff, createOrganization, linkClub } from './org-fixtures'

// The federation hub's membership rules (docs/design/2026-11-26-federation-hub-mvp.md
// §1, §3.2–3.3): a club joins only by its owner's decision, any club admin
// may leave, and org staff never become club staff.

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const CODE = 'FEDR2345'

describe('federation membership', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
    })

    const http = () => ctx.http()

    it('org admin invites a club by code and only the club owner can accept', async () => {
        // The platform creates the federation and names its first admin.
        const platform = await signIn(ctx, PLATFORM_OWNER)
        const created = await http()
            .post('/platform/organizations')
            .set(...platform.auth)
            .send({ name: 'Федерация БЖЖ', type: 'GRAPPLING', city: 'Томск', adminEmail: 'head@federation.test' })
            .expect(201)
        expect(created.body).toMatchObject({ adminCreated: true, organization: { activeClubs: 0 } })
        const orgId: string = created.body.organization.id
        const orgAdmin = await signIn(ctx, 'head@federation.test')

        const coachUser = await createUser(ctx, { email: 'coach@federation.test' })
        await addOrgStaff(ctx, { organizationId: orgId, userId: coachUser.id, role: 'ORG_COACH' })
        const orgCoach = await signIn(ctx, 'coach@federation.test')

        const { workspace, owner } = await createWorkspace(ctx, { name: 'ACADEMY' })
        await ctx.prisma.workspaceJoinCode.create({ data: { workspaceId: workspace.id, code: CODE } })
        const clubAdmin = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.ADMIN })
        const ownerActor = await signIn(ctx, owner.email)
        const adminActor = await signIn(ctx, clubAdmin.user.email as string)

        // «Мои федерации» routes the federation account to its console.
        const mine = await http().get('/orgs/mine').set(...orgAdmin.auth).expect(200)
        expect(mine.body.data).toEqual([expect.objectContaining({ id: orgId, role: 'ORG_ADMIN' })])

        // The admin first previews the club by code (the public lookup).
        const preview = await http().get(`/public/clubs/by-code/${CODE}`).expect(200)
        expect(preview.body.name).toBe('ACADEMY')

        // An org coach cannot invite; an unknown code is 404.
        await http()
            .post(`/orgs/${orgId}/clubs/invitations`)
            .set(...orgCoach.auth)
            .send({ joinCode: CODE })
            .expect(403)
        await http()
            .post(`/orgs/${orgId}/clubs/invitations`)
            .set(...orgAdmin.auth)
            .send({ joinCode: 'ZZZZ9999' })
            .expect(404)

        ctx.mail.clear()
        const invite = await http()
            .post(`/orgs/${orgId}/clubs/invitations`)
            .set(...orgAdmin.auth)
            .send({ joinCode: 'fedr-2345' })
            .expect(201)
        expect(invite.body).toMatchObject({ status: 'INVITED', metrics: null, club: { name: 'ACADEMY' } })
        const linkId: string = invite.body.id
        // The owner hears about it (inbox + e-mail).
        const inbox = await ctx.prisma.notification.findMany({ where: { userId: owner.id } })
        expect(inbox.some((n) => (n.metadata as { kind?: string })?.kind === 'org.club_invited')).toBe(true)
        const mail = await ctx.mail.waitFor((m) => m.to === owner.email && m.subject.includes('приглашает клуб'))
        expect(mail.html).toContain('Настройки → Федерация')
        // Inviting twice is refused.
        await http()
            .post(`/orgs/${orgId}/clubs/invitations`)
            .set(...orgAdmin.auth)
            .send({ joinCode: CODE })
            .expect(409)

        // Pending: the org sees the row, no numbers.
        const pending = await http().get(`/orgs/${orgId}/clubs`).set(...orgCoach.auth).expect(200)
        expect(pending.body.data).toEqual([expect.objectContaining({ id: linkId, status: 'INVITED', metrics: null })])
        expect(pending.body.totals.activeClubs).toBe(0)

        // A club admin who is not the owner sees the card but cannot accept.
        const asAdmin = await http()
            .get(`/workspaces/${workspace.id}/organizations`)
            .set(...adminActor.auth)
            .expect(200)
        expect(asAdmin.body.data).toEqual([expect.objectContaining({ id: linkId, status: 'INVITED', canAccept: false })])
        const refused = await http()
            .post(`/workspaces/${workspace.id}/organizations/${linkId}/accept`)
            .set(...adminActor.auth)
            .send({})
            .expect(403)
        expect(refused.body.message).toContain('только владелец')

        // The owner accepts, opening one money figure.
        const accepted = await http()
            .post(`/workspaces/${workspace.id}/organizations/${linkId}/accept`)
            .set(...ownerActor.auth)
            .send({ sharing: { shareMrr: true } })
            .expect(201)
        expect(accepted.body).toMatchObject({
            status: 'ACTIVE',
            sharing: { shareMrr: true, shareRevenue30d: false, shareRegistry: true },
        })
        await http()
            .post(`/workspaces/${workspace.id}/organizations/${linkId}/accept`)
            .set(...ownerActor.auth)
            .send({})
            .expect(409)

        const active = await http().get(`/orgs/${orgId}/clubs`).set(...orgAdmin.auth).expect(200)
        expect(active.body.data[0]).toMatchObject({ status: 'ACTIVE', metrics: { students: 0 } })
        expect(active.body.totals.activeClubs).toBe(1)
        // The org admins hear that the club joined.
        const adminInbox = await ctx.prisma.notification.findMany({ where: { userId: orgAdmin.userId } })
        expect(adminInbox.some((n) => (n.metadata as { kind?: string })?.kind === 'org.club_joined')).toBe(true)

        // Both journals: the org's (club decision labelled as the club), the club's.
        const orgAudit = await http().get(`/orgs/${orgId}/audit`).set(...orgAdmin.auth).expect(200)
        const actions = orgAudit.body.data.map((e: { action: string }) => e.action)
        expect(actions).toEqual(expect.arrayContaining(['org.create', 'org.inviteClub', 'org.acceptInvite']))
        const acceptEntry = orgAudit.body.data.find((e: { action: string }) => e.action === 'org.acceptInvite')
        expect(acceptEntry).toMatchObject({ actorId: null, actorEmail: null, actorLabel: 'Клуб «ACADEMY»' })
        await http().get(`/orgs/${orgId}/audit`).set(...orgCoach.auth).expect(403)
        const clubAudit = await http()
            .get(`/workspaces/${workspace.id}/audit-events?actionPrefix=org.`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(clubAudit.body.data.map((e: { action: string }) => e.action)).toEqual(['org.acceptInvite'])
    })

    it('club admin leaves and the org loses its numbers and registry rows at once', async () => {
        const org = await createOrganization(ctx)
        const headUser = await createUser(ctx, { email: 'head@federation.test' })
        await addOrgStaff(ctx, { organizationId: org.id, userId: headUser.id })
        const orgAdmin = await signIn(ctx, 'head@federation.test')

        const { workspace, owner } = await createWorkspace(ctx, { name: 'Беркут' })
        const link = await linkClub(ctx, { organizationId: org.id, workspaceId: workspace.id })
        const clubAdmin = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.ADMIN })
        const adminActor = await signIn(ctx, clubAdmin.user.email as string)

        // A student with a belt who consented to the federation.
        const student = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.user.update({ where: { id: student.user.id }, data: { firstname: 'Иван', lastname: 'Иванов' } })
        // The registry shows belts on ladders adopted from this org's standard.
        const template = await ctx.prisma.organizationLadderTemplate.create({
            data: { organizationId: org.id, name: 'Пояса (взрослые)' },
        })
        const ladder = await ctx.prisma.rankLadder.create({
            data: { workspaceId: workspace.id, name: 'Взрослые', templateId: template.id, templateVersion: 1 },
        })
        const level = await ctx.prisma.rankLevel.create({ data: { ladderId: ladder.id, name: 'Синий пояс', order: 2 } })
        await ctx.prisma.rankPromotion.create({
            data: { workspaceId: workspace.id, userId: student.user.id, ladderId: ladder.id, levelId: level.id, awardedById: owner.id },
        })
        await ctx.prisma.consentRecord.create({
            data: { userId: student.user.id, kind: 'ORGANIZATION_SHARING', version: 'e2e', organizationId: org.id },
        })

        const before = await http().get(`/orgs/${org.id}/clubs`).set(...orgAdmin.auth).expect(200)
        expect(before.body.data[0]).toMatchObject({ status: 'ACTIVE', metrics: { students: 1 } })
        expect(before.body.totals).toMatchObject({ activeClubs: 1, students: 1 })
        const registryBefore = await http().get(`/orgs/${org.id}/registry?q=Иванов`).set(...orgAdmin.auth).expect(200)
        expect(registryBefore.body.data).toEqual([
            expect.objectContaining({ personName: expect.stringContaining('Иванов'), clubName: 'Беркут', levelName: 'Синий пояс' }),
        ])

        // Any club admin (not only the owner) may leave.
        const left = await http()
            .post(`/workspaces/${workspace.id}/organizations/${link.id}/leave`)
            .set(...adminActor.auth)
            .expect(201)
        expect(left.body.status).toBe('LEFT')

        // At once — the cached numbers were dropped with the link.
        const after = await http().get(`/orgs/${org.id}/clubs`).set(...orgAdmin.auth).expect(200)
        expect(after.body.data).toEqual([])
        expect(after.body.totals).toMatchObject({ activeClubs: 0, students: 0 })
        const registryAfter = await http().get(`/orgs/${org.id}/registry?q=Иванов`).set(...orgAdmin.auth).expect(200)
        expect(registryAfter.body.data).toEqual([])

        // Leaving twice is refused; the org may re-invite (the row is reused).
        await http()
            .post(`/workspaces/${workspace.id}/organizations/${link.id}/leave`)
            .set(...adminActor.auth)
            .expect(409)
    })

    describe('org staff cannot call any workspace route of a member club', () => {
        type SpecParameter = { name: string; in: string; required?: boolean; schema?: { format?: string; type?: string; minLength?: number; pattern?: string } }
        const ABSENT_ID = '00000000-0000-4000-8000-000000000000'
        const PATTERN_SAMPLES = ['2026-01', '2026-01-01', '1', '11', 'a', 'ab']
        const spec = JSON.parse(
            fs.readFileSync(path.resolve(__dirname, '../../../../open-api.json'), 'utf8'),
        ) as { paths: Record<string, Record<string, { parameters?: SpecParameter[] }>> }
        const query = (params: SpecParameter[]) => {
            const pairs = params
                .filter((p) => p.in === 'query' && p.required)
                .map((p) => {
                    if (p.schema?.format === 'date') return `${p.name}=2026-01-01`
                    if (p.schema?.format === 'date-time') return `${p.name}=2026-01-01T00:00:00.000Z`
                    if (p.schema?.type === 'number' || p.schema?.type === 'integer') return `${p.name}=1`
                    const pattern = p.schema?.pattern
                    if (pattern) {
                        const sample = PATTERN_SAMPLES.find((s) => new RegExp(pattern).test(s)) ?? 'a'
                        return `${p.name}=${encodeURIComponent(sample)}`
                    }
                    return `${p.name}=${'1'.repeat(p.schema?.minLength ?? 1)}`
                })
            return pairs.length ? `?${pairs.join('&')}` : ''
        }
        const OPS = Object.entries(spec.paths)
            .filter(([route]) => route.startsWith('/workspaces/{workspaceId}'))
            .flatMap(([route, methods]) =>
                Object.entries(methods).map(([method, op]) => ({
                    method: method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete',
                    route,
                    query: query(op.parameters ?? []),
                })),
            )

        let workspaceId: string
        let orgId: string
        let staff: Actor[]

        beforeEach(async () => {
            const org = await createOrganization(ctx)
            orgId = org.id
            const { workspace } = await createWorkspace(ctx, { name: 'Member Club' })
            workspaceId = workspace.id
            await addMember(ctx, { workspaceId })
            await linkClub(ctx, { organizationId: org.id, workspaceId, sharing: { shareMrr: true, shareRevenue30d: true } })
            const admin = await createUser(ctx, { email: 'org-admin@federation.test' })
            const coach = await createUser(ctx, { email: 'org-coach@federation.test' })
            await addOrgStaff(ctx, { organizationId: org.id, userId: admin.id, role: 'ORG_ADMIN' })
            await addOrgStaff(ctx, { organizationId: org.id, userId: coach.id, role: 'ORG_COACH' })
            staff = [await signIn(ctx, admin.email as string), await signIn(ctx, coach.email as string)]
        })

        it('found the workspace surface to probe', () => {
            expect(OPS.length).toBeGreaterThan(100)
        })

        it('every workspace route of the member club refuses org admins and org coaches (4xx, never 2xx/5xx)', async () => {
            const leaked: string[] = []
            for (const actor of staff) {
                for (const op of OPS) {
                    const url = op.route.replace('{workspaceId}', workspaceId).replace(/\{[^}]+\}/g, ABSENT_ID) + op.query
                    const res = await http()[op.method](url).set(...actor.auth).send({})
                    if (res.status < 400 || res.status >= 500) {
                        leaked.push(`${actor.email} ${op.method.toUpperCase()} ${op.route} → ${res.status}`)
                    }
                }
            }
            expect(leaked).toEqual([])
            // Never a WorkspaceMember row for org staff.
            const rows = await ctx.prisma.workspaceMember.count({
                where: { workspaceId, userId: { in: staff.map((s) => s.userId) } },
            })
            expect(rows).toBe(0)
        })

        it('and the club side cannot open the org console (404, no existence leak)', async () => {
            const { ownerId } = await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { ownerId: true } })
            const owner = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
            const ownerActor = await signIn(ctx, owner.email as string)
            for (const route of ['', '/clubs', '/registry', '/events', '/members', '/audit']) {
                await http().get(`/orgs/${orgId}${route}`).set(...ownerActor.auth).expect(404)
            }
            // The org console itself works for its staff (the control).
            await http().get(`/orgs/${orgId}/clubs`).set(...staff[1].auth).expect(200)
        })
    })
})
