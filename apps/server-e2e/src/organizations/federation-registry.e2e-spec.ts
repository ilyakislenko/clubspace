import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { addOrgStaff, createOrganization, linkClub } from './org-fixtures'

// «Реестр поясов» (docs/design/2026-11-26-federation-hub-mvp.md §1, §3.1):
// belts confirmed by member clubs, name + belt + club + date only, and only of
// people who consented to that federation (a guardian for a child).
describe('federation registry', () => {
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
    })

    const http = () => ctx.http()
    const ROW_KEYS = [
        'awardedAt',
        'clubId',
        'clubName',
        'ladderName',
        'levelColor',
        'levelName',
        'personKey',
        'personName',
        'stripes',
        'templateLevelName',
    ]

    const setup = async () => {
        const org = await createOrganization(ctx, { name: 'Федерация БЖЖ', timezone: 'Asia/Tomsk' })
        const { workspace, owner } = await createWorkspace(ctx, { name: 'ACADEMY' })
        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { timezone: 'Asia/Tomsk' },
        })
        const link = await linkClub(ctx, { organizationId: org.id, workspaceId: workspace.id })
        const orgCoachUser = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: org.id, userId: orgCoachUser.id, role: 'ORG_COACH' })
        const orgCoach = await signIn(ctx, orgCoachUser.email!)

        // The club's BJJ ladder is a copy of the federation standard; its MMA
        // ladder is its own and must never reach the federation.
        const standard = await ctx.prisma.organizationLadderTemplate.create({
            data: {
                organizationId: org.id,
                name: 'Пояса (взрослые)',
                version: 2,
                levels: {
                    create: [
                        { name: 'Белый', order: 0, maxStripes: 4 },
                        { name: 'Синий', order: 1, maxStripes: 4 },
                    ],
                },
            },
            include: { levels: { orderBy: { order: 'asc' } } },
        })
        const ladder = await ctx.prisma.rankLadder.create({
            data: {
                workspaceId: workspace.id,
                name: 'Пояса (взрослые)',
                templateId: standard.id,
                templateVersion: 2,
            },
        })
        const white = await ctx.prisma.rankLevel.create({
            data: {
                ladderId: ladder.id,
                name: 'Белый пояс',
                order: 0,
                color: '#ffffff',
                maxStripes: 4,
                templateLevelId: standard.levels[0].id,
            },
        })
        const blue = await ctx.prisma.rankLevel.create({
            data: {
                ladderId: ladder.id,
                name: 'Синий пояс',
                order: 1,
                color: '#1e40af',
                maxStripes: 4,
                templateLevelId: standard.levels[1].id,
            },
        })
        const mma = await ctx.prisma.rankLadder.create({
            data: { workspaceId: workspace.id, name: 'Уровни ММА' },
        })
        const mmaLevel = await ctx.prisma.rankLevel.create({
            data: { ladderId: mma.id, name: 'Продвинутый', order: 0 },
        })
        const promote = (
            userId: string,
            levelId: string,
            awardedAt: string,
            stripes = 0,
            ladderId = ladder.id,
        ) =>
            ctx.prisma.rankPromotion.create({
                data: {
                    workspaceId: workspace.id,
                    userId,
                    ladderId,
                    levelId,
                    stripes,
                    awardedById: owner.id,
                    awardedAt: new Date(awardedAt),
                },
            })

        const studentUser = await createUser(ctx, { firstname: 'Иван' })
        await ctx.prisma.user.update({
            where: { id: studentUser.id },
            data: { lastname: 'Иванов', phone: '+79001112233' },
        })
        await addMember(ctx, { workspaceId: workspace.id, userId: studentUser.id })
        await promote(studentUser.id, white.id, '2026-03-01T05:00:00Z', 4)
        // 01.11 00:30 in Tomsk is still 31.10 in UTC: the club-local date wins.
        await promote(studentUser.id, blue.id, '2026-10-31T17:30:00Z', 1)
        // The newest promotion of all, on the club's own MMA ladder.
        await promote(studentUser.id, mmaLevel.id, '2026-11-20T05:00:00Z', 0, mma.id)
        const student = await signIn(ctx, studentUser.email!)

        return { org, workspace, owner, link, orgCoach, student, studentUser, promote, white, blue, standard, ladder }
    }
    type Setup = Awaited<ReturnType<typeof setup>>

    const registry = (s: Setup, actor: Actor, query = '') =>
        http().get(`/orgs/${s.org.id}/registry${query}`).set(...actor.auth)
    const consent = (s: Setup, actor: Actor, granted: boolean, extra?: [string, string]) => {
        const req = http()
            .put(`/workspaces/${s.workspace.id}/me/organizations/${s.org.id}/consent`)
            .set(...actor.auth)
        if (extra) req.set(...extra)
        return req.send({ granted })
    }

    it('belt shows as confirmed by the club only after the member consents', async () => {
        const s = await setup()

        // No consent yet: the org sees nobody.
        expect((await registry(s, s.orgCoach).expect(200)).body).toMatchObject({ data: [], total: 0 })

        // The member reads the consent text, then turns the switch on.
        const mine = (
            await http()
                .get(`/workspaces/${s.workspace.id}/me/organizations`)
                .set(...s.student.auth)
                .expect(200)
        ).body.data
        expect(mine).toEqual([
            expect.objectContaining({
                organizationId: s.org.id,
                name: 'Федерация БЖЖ',
                consentGranted: false,
                visibleInRegistry: false,
            }),
        ])
        expect(mine[0].consentText).toContain('«Федерация БЖЖ»')
        const granted = (await consent(s, s.student, true).expect(200)).body
        // «в реестре» only under the ladder the federation actually sees — not MMA.
        expect(granted).toMatchObject({
            consentGranted: true,
            visibleInRegistry: true,
            registryLadderIds: [s.ladder.id],
        })
        const evidence = await ctx.prisma.consentRecord.findMany({
            where: { kind: 'ORGANIZATION_SHARING' },
        })
        expect(evidence).toEqual([
            expect.objectContaining({
                userId: s.studentUser.id,
                dependentId: null,
                organizationId: s.org.id,
                withdrawnAt: null,
            }),
        ])

        // Latest belt per linked ladder, club-local date, nothing else about the
        // person; the club's own MMA ladder (newest promotion) stays out.
        const found = (await registry(s, s.orgCoach, `?q=${encodeURIComponent('иванов')}`).expect(200))
            .body
        expect(found.total).toBe(1)
        expect(found.data[0]).toMatchObject({
            personName: 'Иван Иванов',
            levelName: 'Синий пояс',
            levelColor: '#1e40af',
            stripes: 1,
            ladderName: 'Пояса (взрослые)',
            clubId: s.workspace.id,
            clubName: 'ACADEMY',
            awardedAt: '2026-11-01',
            templateLevelName: 'Синий',
        })
        expect(Object.keys(found.data[0]).sort()).toEqual(ROW_KEYS)
        expect(JSON.stringify(found)).not.toMatch(/ММА|Продвинутый/)
        // The standard-level filter.
        expect(
            (await registry(s, s.orgCoach, `?templateLevelId=${s.standard.levels[1].id}`).expect(200)).body
                .total,
        ).toBe(1)
        expect(
            (await registry(s, s.orgCoach, `?templateLevelId=${s.standard.levels[0].id}`).expect(200)).body
                .total,
        ).toBe(0)
        const raw = JSON.stringify(found)
        expect(raw).not.toContain(s.studentUser.id)
        expect(raw).not.toContain(s.studentUser.email!)
        expect(raw).not.toContain('79001112233')
        expect(raw).not.toContain(s.owner.id)

        // A miss, a date filter outside the promotion, and another club filter.
        expect((await registry(s, s.orgCoach, '?q=Петров').expect(200)).body.total).toBe(0)
        // 02.11 onwards: only the MMA promotion (20.11), which is not the federation's.
        expect((await registry(s, s.orgCoach, '?awardedFrom=2026-11-02').expect(200)).body.total).toBe(0)
        expect(
            (await registry(s, s.orgCoach, '?awardedFrom=2026-11-01&awardedTo=2026-11-01').expect(200))
                .body.total,
        ).toBe(1)

        // The history panel: every confirmed belt, newest first.
        const person = (
            await http()
                .get(`/orgs/${s.org.id}/registry/${found.data[0].personKey}`)
                .set(...s.orgCoach.auth)
                .expect(200)
        ).body
        expect(person.history.map((h: { levelName: string }) => h.levelName)).toEqual([
            'Синий пояс',
            'Белый пояс',
        ])

        // The club's own switch is a second gate.
        await ctx.prisma.organizationClub.update({
            where: { id: s.link.id },
            data: { shareRegistry: false },
        })
        expect((await registry(s, s.orgCoach).expect(200)).body.total).toBe(0)

        // A stranger to the org gets 404, not an empty list.
        await registry(s, s.student).expect(404)
    })

    it("withdrawn consent removes the person; a child appears only with a guardian's consent", async () => {
        const s = await setup()
        await consent(s, s.student, true).expect(200)
        const before = (await registry(s, s.orgCoach).expect(200)).body
        expect(before.total).toBe(1)
        const key = before.data[0].personKey

        // Withdrawal takes effect on the next read.
        await consent(s, s.student, false).expect(200)
        expect((await registry(s, s.orgCoach).expect(200)).body.total).toBe(0)
        await http().get(`/orgs/${s.org.id}/registry/${key}`).set(...s.orgCoach.auth).expect(404)
        const record = await ctx.prisma.consentRecord.findFirstOrThrow({
            where: { kind: 'ORGANIZATION_SHARING', userId: s.studentUser.id },
        })
        expect(record.withdrawnAt).toBeInstanceOf(Date)

        // A child: a dependent without a login, a confirmed guardianship.
        const parentUser = await createUser(ctx, { firstname: 'Ольга' })
        const child = await ctx.prisma.user.create({
            data: { email: null, status: 'ACTIVE', language: 'RU', firstname: 'Миша', lastname: 'Петров' },
        })
        await ctx.prisma.guardianship.create({
            data: { guardianId: parentUser.id, dependentId: child.id, consentAt: new Date(), consentVersion: '2026-11-01' },
        })
        await addMember(ctx, { workspaceId: s.workspace.id, userId: child.id })
        await s.promote(child.id, s.white.id, '2026-09-01T05:00:00Z', 2)
        const parent = await signIn(ctx, parentUser.email!)

        expect((await registry(s, s.orgCoach, '?q=Петров').expect(200)).body.total).toBe(0)
        // The guardian consents acting as the child.
        const out = (await consent(s, parent, true, ['X-Act-As', child.id]).expect(200)).body
        expect(out).toMatchObject({ consentGranted: true })
        const kidRecord = await ctx.prisma.consentRecord.findFirstOrThrow({
            where: { kind: 'ORGANIZATION_SHARING', dependentId: child.id },
        })
        expect(kidRecord).toMatchObject({ userId: parentUser.id, organizationId: s.org.id })
        const kid = (await registry(s, s.orgCoach, '?q=Петров').expect(200)).body
        expect(kid.data).toEqual([
            expect.objectContaining({ personName: 'Миша Петров', levelName: 'Белый пояс', stripes: 2 }),
        ])
        expect(JSON.stringify(kid)).not.toContain(child.id)

        // A club that left the federation shares nothing at once.
        await ctx.prisma.organizationClub.update({ where: { id: s.link.id }, data: { status: 'LEFT' } })
        expect((await registry(s, s.orgCoach).expect(200)).body.total).toBe(0)
        // …and its members no longer see the org in their settings.
        expect(
            (
                await http()
                    .get(`/workspaces/${s.workspace.id}/me/organizations`)
                    .set(...s.student.auth)
                    .expect(200)
            ).body.data,
        ).toEqual([])
        await consent(s, s.student, true).expect(404)
    })

    it('a person key from one federation means nothing in another', async () => {
        const s = await setup()
        await consent(s, s.student, true).expect(200)
        const key = (await registry(s, s.orgCoach).expect(200)).body.data[0].personKey

        const other = await createOrganization(ctx, { name: 'Другая сеть' })
        await linkClub(ctx, { organizationId: other.id, workspaceId: s.workspace.id })
        const otherAdminUser = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: other.id, userId: otherAdminUser.id })
        const otherAdmin = await signIn(ctx, otherAdminUser.email!)

        // Consent is per federation: the other one sees nobody, and the key is unknown there.
        expect(
            (await http().get(`/orgs/${other.id}/registry`).set(...otherAdmin.auth).expect(200)).body.total,
        ).toBe(0)
        await http().get(`/orgs/${other.id}/registry/${key}`).set(...otherAdmin.auth).expect(404)
        // Nor can its staff read the first federation.
        await http().get(`/orgs/${s.org.id}/registry`).set(...otherAdmin.auth).expect(404)
    })
})
