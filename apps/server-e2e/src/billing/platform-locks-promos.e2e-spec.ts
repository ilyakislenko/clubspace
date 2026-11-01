import { addMonths } from '../../../server/src/domains/billing/billing-rules'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const DAY = 86_400_000

// The platform console pinning a club's app sections (the club's admin sees
// them disabled and the server refuses changes until unlocked or the date
// passes), one-click promo presets with their quote preview, and the club
// list's filters and sorting.
describe('platform locks and promos', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    let adminAuth: [string, string] | null = null

    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        adminAuth = null
    })

    const platformAdmin = async () => {
        adminAuth ??= (await signIn(ctx, PLATFORM_OWNER)).auth
        return adminAuth
    }

    const lock = async (workspaceId: string, body: Record<string, unknown>) =>
        ctx
            .http()
            .post(`/platform/workspaces/${workspaceId}/feature-locks`)
            .set(...(await platformAdmin()))
            .send(body)

    const unlock = async (workspaceId: string, feature: string) =>
        ctx
            .http()
            .delete(`/platform/workspaces/${workspaceId}/feature-locks/${feature}`)
            .set(...(await platformAdmin()))

    const promo = async (
        workspaceId: string,
        body: Record<string, unknown>,
        preview = false,
    ) =>
        ctx
            .http()
            .post(`/platform/workspaces/${workspaceId}/promos${preview ? '/preview' : ''}`)
            .set(...(await platformAdmin()))
            .send(body)

    const settings = (workspaceId: string, actor: Actor) => ({
        get: () =>
            ctx.http().get(`/workspaces/${workspaceId}/settings`).set(...actor.auth),
        patch: (body: Record<string, unknown>) =>
            ctx
                .http()
                .patch(`/workspaces/${workspaceId}/settings`)
                .set(...actor.auth)
                .send(body),
    })

    const clubBilling = (workspaceId: string, actor: Actor) =>
        ctx.http().get(`/workspaces/${workspaceId}/billing`).set(...actor.auth)

    describe('feature locks', () => {
        it('a locked switch is reported, refused to the club admin, and handed back on unlock', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const ownerActor = await signIn(ctx, owner.email)
            const club = settings(workspace.id, ownerActor)

            const locked = await lock(workspace.id, { feature: 'events', enabled: false })
            expect(locked.status).toBe(201)
            expect(locked.body.features.events).toBe(false)
            expect(locked.body.featureLocks).toEqual([
                { feature: 'events', enabled: false, until: null },
            ])

            const read = await club.get().expect(200)
            expect(read.body.eventsEnabled).toBe(false)
            expect(read.body.lockedFeatures).toEqual([
                { feature: 'events', enabled: false, until: null },
            ])

            const refused = await club.patch({ eventsEnabled: true })
            expect(refused.status).toBe(403)
            expect(refused.body.message).toBe(
                'Раздел «События» установлен платформой — изменить его может только ClubSpace',
            )
            // A whole-form save re-sending the pinned value, and other
            // switches, still go through.
            const other = await club.patch({ eventsEnabled: false, ranksEnabled: false }).expect(200)
            expect(other.body.ranksEnabled).toBe(false)
            expect(other.body.lockedFeatures).toHaveLength(1)
            const row = await ctx.prisma.workspace.findUniqueOrThrow({
                where: { id: workspace.id },
            })
            expect(row.eventsEnabled).toBe(false)

            const lifted = await unlock(workspace.id, 'events')
            expect(lifted.status).toBe(200)
            expect(lifted.body.featureLocks).toEqual([])
            const back = await club.patch({ eventsEnabled: true }).expect(200)
            expect(back.body.eventsEnabled).toBe(true)
            expect(back.body.lockedFeatures).toEqual([])

            const journal = await ctx.prisma.auditEvent.findMany({
                where: {
                    workspaceId: workspace.id,
                    action: { in: ['workspace.featureLock', 'workspace.featureUnlock'] },
                },
                orderBy: { createdAt: 'asc' },
            })
            expect(journal.map((e) => e.action)).toEqual([
                'workspace.featureLock',
                'workspace.featureUnlock',
            ])
            expect(locked.body.audit.map((e: { action: string }) => e.action)).toContain(
                'workspace.featureLock',
            )
        })

        it('a lock with an end date holds until it, then the club has the switch back', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const club = settings(workspace.id, await signIn(ctx, owner.email))
            const until = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10)

            const res = await lock(workspace.id, { feature: 'journal', enabled: true, until })
            expect(res.status).toBe(201)
            expect(res.body.featureLocks[0]).toMatchObject({ feature: 'journal', enabled: true })
            expect(res.body.featureLocks[0].until.slice(0, 10)).toBe(until)
            await club.patch({ journalEnabled: false }).expect(403)

            // The date passes.
            await ctx.prisma.workspaceFeatureLock.updateMany({
                where: { workspaceId: workspace.id },
                data: { until: new Date(Date.now() - 1000) },
            })
            const read = await club.get().expect(200)
            expect(read.body.lockedFeatures).toEqual([])
            await club.patch({ journalEnabled: false }).expect(200)

            // A date already past is refused outright.
            const past = await lock(workspace.id, {
                feature: 'journal',
                enabled: true,
                until: '2020-01-01',
            })
            expect(past.status).toBe(400)
        })

        it('a lock in one club leaves another club alone', async () => {
            const a = await createWorkspace(ctx)
            const b = await createWorkspace(ctx)
            await lock(a.workspace.id, { feature: 'events', enabled: false }).then((r) =>
                expect(r.status).toBe(201),
            )
            const ownerB = await signIn(ctx, b.owner.email)
            const clubB = settings(b.workspace.id, ownerB)
            expect((await clubB.get().expect(200)).body.lockedFeatures).toEqual([])
            await clubB.patch({ eventsEnabled: false }).expect(200)
            // Unlocking in B has nothing to unlock and leaves A's lock.
            expect((await unlock(b.workspace.id, 'events')).status).toBe(404)
            expect(
                await ctx.prisma.workspaceFeatureLock.count({
                    where: { workspaceId: a.workspace.id },
                }),
            ).toBe(1)
            // B's owner can neither lift A's lock nor touch A's settings.
            await ctx
                .http()
                .delete(`/platform/workspaces/${a.workspace.id}/feature-locks/events`)
                .set(...ownerB.auth)
                .expect(403)
            await settings(a.workspace.id, ownerB).patch({ eventsEnabled: true }).expect(403)
            expect(
                (await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: a.workspace.id } }))
                    .eventsEnabled,
            ).toBe(false)
        })
    })

    describe('only the platform admin', () => {
        it('locks, unlocks, previews and applies promos', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const { user: clubAdmin } = await addMember(ctx, {
                workspaceId: workspace.id,
                role: RolesEnum.ADMIN,
            })
            const other = await createWorkspace(ctx)
            for (const email of [owner.email, clubAdmin.email, other.owner.email]) {
                const actor = await signIn(ctx, email)
                const base = `/platform/workspaces/${workspace.id}`
                await ctx
                    .http()
                    .post(`${base}/feature-locks`)
                    .set(...actor.auth)
                    .send({ feature: 'events', enabled: false })
                    .expect(403)
                await ctx
                    .http()
                    .delete(`${base}/feature-locks/events`)
                    .set(...actor.auth)
                    .expect(403)
                await ctx
                    .http()
                    .post(`${base}/promos/preview`)
                    .set(...actor.auth)
                    .send({ preset: 'FREE_MONTHS', months: 3 })
                    .expect(403)
                await ctx
                    .http()
                    .post(`${base}/promos`)
                    .set(...actor.auth)
                    .send({ preset: 'FREE_MONTHS', months: 3 })
                    .expect(403)
                await ctx
                    .http()
                    .get('/platform/workspaces')
                    .set(...actor.auth)
                    .expect(403)
            }
            expect(
                await ctx.prisma.workspaceFeatureLock.count({ where: { workspaceId: workspace.id } }),
            ).toBe(0)
            const row = await ctx.prisma.workspaceBilling.findUnique({
                where: { workspaceId: workspace.id },
            })
            expect(row?.freeUntil ?? null).toBeNull()
        })
    })

    describe('promo presets', () => {
        // A fresh club on its trial with no active students: the first charge
        // after the trial is the Старт tier (2 990) plus the setup fee (4 990).
        const fresh = async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const ownerActor = await signIn(ctx, owner.email)
            const first = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(first.body.billing.quote.total).toBe(7980)
            return {
                workspace,
                ownerActor,
                trialEndsAt: new Date(first.body.billing.trialEndsAt),
            }
        }

        it('«Скидка 50% на 2 месяца»: previewed, applied, shown to the club, gone after its date', async () => {
            const { workspace, ownerActor, trialEndsAt } = await fresh()
            const body = { preset: 'DISCOUNT', months: 2, discountPercent: 50 }

            const preview = await promo(workspace.id, body, true)
            expect(preview.status).toBe(201)
            expect(preview.body.current.quote.total).toBe(7980)
            expect(preview.body.next.quote.discounts).toEqual([
                expect.objectContaining({ code: 'platform', amount: 1495 }),
            ])
            expect(preview.body.next.quote.total).toBe(6485)
            // The preview wrote nothing.
            const untouched = await ctx.prisma.workspaceBilling.findUniqueOrThrow({
                where: { workspaceId: workspace.id },
            })
            expect(untouched.discountPercent).toBe(0)

            const applied = await promo(workspace.id, body)
            expect(applied.status).toBe(201)
            expect(applied.body.billing.quote.total).toBe(6485)
            const until = addMonths(trialEndsAt, 2).toISOString()
            expect(applied.body.overrides).toMatchObject({
                discountPercent: 50,
                discountUntil: until,
            })
            expect(applied.body.audit.map((e: { action: string }) => e.action)).toContain(
                'workspace.promoApply',
            )

            // The club's «Тариф» page lists the promo with its end date.
            const club = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(club.body.billing.promos).toEqual([
                { kind: 'DISCOUNT', title: 'Скидка 50% на подписку и модули', until },
            ])
            expect(club.body.billing.quote.total).toBe(6485)

            // A period starting on the end date is charged in full.
            await ctx.prisma.workspaceBilling.update({
                where: { workspaceId: workspace.id },
                data: { discountUntil: trialEndsAt },
            })
            const ended = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(ended.body.billing.quote.discounts).toEqual([])
            expect(ended.body.billing.quote.total).toBe(7980)

            // Once the date is behind us the promo is no longer listed.
            await ctx.prisma.workspaceBilling.update({
                where: { workspaceId: workspace.id },
                data: { discountUntil: new Date(Date.now() - 1000) },
            })
            const gone = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(gone.body.billing.promos).toEqual([])
        })

        it('«1 месяц бесплатно» moves the first charge a month past the trial', async () => {
            const { workspace, ownerActor, trialEndsAt } = await fresh()
            const preview = await promo(workspace.id, { preset: 'FREE_MONTHS', months: 1 }, true)
            const freeUntil = addMonths(trialEndsAt, 1).toISOString()
            expect(preview.body.summary).toMatch(/^1 мес\. бесплатно — до /)
            expect(preview.body.current.nextChargeAt).toBe(trialEndsAt.toISOString())
            expect(preview.body.next.nextChargeAt).toBe(freeUntil)

            const applied = await promo(workspace.id, { preset: 'FREE_MONTHS', months: 1 })
            expect(applied.status).toBe(201)
            expect(applied.body.billing.nextChargeAt).toBe(freeUntil)
            const club = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(club.body.billing.promos).toEqual([
                { kind: 'FREE_PERIOD', title: 'Подписка бесплатно', until: freeUntil },
            ])
        })

        it('«Без платы за подключение» drops the setup fee; «Видео в подарок» puts VIDEO on at 0', async () => {
            const { workspace, ownerActor } = await fresh()
            const noFee = await promo(workspace.id, { preset: 'NO_SETUP_FEE' })
            expect(noFee.status).toBe(201)
            expect(noFee.body.billing.quote.total).toBe(2990)
            expect(
                noFee.body.billing.quote.lines.map((l: { code: string }) => l.code),
            ).not.toContain('setup')

            const video = await promo(workspace.id, { preset: 'VIDEO_GIFT', months: 2 })
            expect(video.status).toBe(201)
            const videoModule = video.body.billing.modules.find(
                (m: { code: string }) => m.code === 'VIDEO',
            )
            expect(videoModule).toMatchObject({ mode: 'COMP', entitled: true })
            expect(
                video.body.billing.quote.lines.find(
                    (l: { code: string }) => l.code === 'module:VIDEO',
                ),
            ).toMatchObject({ amount: 0 })
            expect(video.body.billing.quote.total).toBe(2990)

            const club = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(club.body.billing.promos.map((p: { kind: string }) => p.kind)).toEqual([
                'MODULE_GIFT',
                'SETUP_FEE_WAIVED',
            ])
            const journal = await ctx.prisma.auditEvent.count({
                where: { workspaceId: workspace.id, action: 'workspace.promoApply' },
            })
            expect(journal).toBe(2)
        })

        it('a promo in one club changes nothing in another', async () => {
            const a = await fresh()
            const b = await createWorkspace(ctx)
            await promo(a.workspace.id, { preset: 'NO_SETUP_FEE' }).then((r) =>
                expect(r.status).toBe(201),
            )
            const ownerB = await signIn(ctx, b.owner.email)
            const billingB = await clubBilling(b.workspace.id, ownerB).expect(200)
            expect(billingB.body.billing.promos).toEqual([])
            expect(billingB.body.billing.quote.total).toBe(7980)
            // B's owner cannot read A's billing either.
            await clubBilling(a.workspace.id, ownerB).expect(403)
        })
    })

    describe('club list', () => {
        it('filters by status, tier and promo, sorts by active members, searches by owner email', async () => {
            const a = await createWorkspace(ctx, { name: 'Фильтр Альфа' })
            const b = await createWorkspace(ctx, { name: 'Фильтр Бета' })
            const c = await createWorkspace(ctx, { name: 'Фильтр Вега' })
            await ctx.prisma.workspaceBilling.create({
                data: {
                    workspaceId: b.workspace.id,
                    status: 'PAST_DUE',
                    pastDueSince: new Date(),
                },
            })
            for (let i = 0; i < 2; i++) {
                const { member } = await addMember(ctx, { workspaceId: c.workspace.id })
                await ctx.prisma.workspaceMember.update({
                    where: { id: member.id },
                    data: { lastSeenAt: new Date() },
                })
            }
            await promo(c.workspace.id, { preset: 'NO_SETUP_FEE' }).then((r) =>
                expect(r.status).toBe(201),
            )

            const list = async (query: Record<string, string>) => {
                const res = await ctx
                    .http()
                    .get('/platform/workspaces')
                    .query({ search: 'Фильтр', ...query })
                    .set(...(await platformAdmin()))
                    .expect(200)
                return res.body as {
                    data: { workspaceId: string; promos: { kind: string }[] }[]
                    meta: { total: number }
                    tiers: { code: string }[]
                }
            }
            const ids = (r: { data: { workspaceId: string }[] }) =>
                r.data.map((w) => w.workspaceId)

            expect((await list({})).meta.total).toBe(3)
            expect(ids(await list({ status: 'PAST_DUE' }))).toEqual([b.workspace.id])
            const promos = await list({ promo: 'true' })
            expect(ids(promos)).toEqual([c.workspace.id])
            expect(promos.data[0].promos[0].kind).toBe('SETUP_FEE_WAIVED')
            expect(ids(await list({ promo: 'false' })).sort()).toEqual(
                [a.workspace.id, b.workspace.id].sort(),
            )
            const byActive = await list({ sort: 'activeMembers', order: 'desc' })
            expect(ids(byActive)[0]).toBe(c.workspace.id)
            expect(byActive.tiers.map((t) => t.code)).toContain('start')
            expect((await list({ tier: 'start' })).meta.total).toBe(3)
            expect((await list({ tier: 'club' })).meta.total).toBe(0)

            const byEmail = await ctx
                .http()
                .get('/platform/workspaces')
                .query({ search: a.owner.email })
                .set(...(await platformAdmin()))
                .expect(200)
            expect(ids(byEmail.body)).toEqual([a.workspace.id])
        })
    })
})
