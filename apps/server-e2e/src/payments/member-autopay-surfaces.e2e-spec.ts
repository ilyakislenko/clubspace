import { AUTOPAY_CONSENT_VERSION } from '../../../server/src/domains/autopay/autopay-consent'
import { environment } from '../../../server/src/environments/environment'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 60 * 60 * 1000

// Member autopay — the member's and staff's surfaces
// (docs/design/2026-11-15-member-autopay.md §3.5, §4, §11). Agreements are
// written straight to the database: how they are set up and charged is
// member-autopay.e2e-spec.ts's job; here the endpoints and the writer hooks
// that read and stop them.
describe('member autopay surfaces', () => {
    let ctx: TestApp
    const gateway = new FakeGateway()
    const switchWas = environment.memberAutopay.enabled

    beforeAll(async () => {
        ctx = await createTestApp({ paymentGateway: gateway })
    })
    afterAll(async () => {
        environment.memberAutopay.enabled = switchWas
        await ctx?.close()
    })
    beforeEach(async () => {
        environment.memberAutopay.enabled = true
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        gateway.reset()
    })

    type Setup = Awaited<ReturnType<typeof setup>>

    const setup = async (o: { memberAccessUntil?: Date | null } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { member, user: memberUser } = await addMember(ctx, {
            workspaceId: workspace.id,
            accessUntil: o.memberAccessUntil ?? null,
        })
        const { user: headCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.HEAD_COACH,
        })
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Безлимит',
            price: 4000,
            classCount: null,
            durationDays: 30,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, memberUser.email)
        const headCoachActor = await signIn(ctx, headCoach.email)
        const coachActor = await signIn(ctx, coach.email)
        return {
            workspace,
            plan,
            member,
            memberUser,
            ownerActor,
            memberActor,
            headCoachActor,
            coachActor,
        }
    }

    // ЮKassa connected with «Автоплатежи для учеников» on, the tariff ticked.
    const enableAutopay = async (s: Setup) => {
        const saved = await http(s.ownerActor)
            .put(`/workspaces/${s.workspace.id}/payment-settings`)
            .send({
                provider: 'YOOKASSA',
                shopId: '123456',
                secretKey: 'test_secret_0001',
                autopayEnabled: true,
            })
        expect(saved.status).toBe(200)
        const ticked = await http(s.ownerActor)
            .patch(`/workspaces/${s.workspace.id}/plans/${s.plan.id}`)
            .send({ purchasableOnline: true, autopayAvailable: true })
        expect(ticked.status).toBe(200)
        expect(ticked.body.autopayAvailable).toBe(true)
    }

    // The member's current abonement (bought online) and the agreement that
    // renews it, as the setup checkout leaves them.
    const agreeAutopay = async (s: Setup, over: Record<string, unknown> = {}) => {
        const now = Date.now()
        const sub = await ctx.prisma.subscription.create({
            data: {
                workspaceId: s.workspace.id,
                workspaceMemberId: s.member.id,
                userId: s.memberUser.id,
                planId: s.plan.id,
                status: 'ACTIVE',
                startDate: new Date(now - 10 * DAY),
                endDate: new Date(now + 20 * DAY),
                durationDays: 30,
                amountPaid: 4000,
                listPrice: 4000,
                currency: 'RUB',
                isPaid: true,
                paidAt: new Date(now - 10 * DAY),
                paymentMethod: 'ONLINE',
                source: 'GATEWAY',
            },
        })
        const autopay = await ctx.prisma.memberAutopay.create({
            data: {
                workspaceId: s.workspace.id,
                userId: s.memberUser.id,
                planId: s.plan.id,
                planName: s.plan.name,
                liveKey: `${s.memberUser.id}:${s.plan.id}`,
                provider: 'YOOKASSA',
                paymentMethodId: 'pm-e2e-0001',
                paymentMethodTitle: 'Bank card *4444',
                cardLast4: '4444',
                shopId: '123456',
                receiptEmail: s.memberUser.email ?? 'member@example.com',
                termsAmount: 4000,
                currency: 'RUB',
                termsDurationDays: 30,
                termsClassCount: null,
                consentVersion: AUTOPAY_CONSENT_VERSION,
                consentedAt: new Date(now - 10 * DAY),
                ...over,
            },
        })
        await ctx.prisma.payment.create({
            data: {
                workspaceId: s.workspace.id,
                userId: s.memberUser.id,
                planId: s.plan.id,
                planName: s.plan.name,
                provider: 'YOOKASSA',
                providerPaymentId: 'yk-setup-0001',
                status: 'SUCCEEDED',
                amount: 4000,
                currency: 'RUB',
                idempotenceKey: `e2e-setup-${autopay.id}`,
                subscriptionId: sub.id,
                autopayId: autopay.id,
                autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
                paidAt: new Date(now - 10 * DAY),
            },
        })
        return { autopay, sub }
    }

    const http = (actor: Actor) => {
        const agent = ctx.http()
        const withAuth = <T extends { set: (k: string, v: string) => T }>(req: T) =>
            req.set(...actor.auth)
        return {
            get: (url: string) => withAuth(agent.get(url)),
            post: (url: string) => withAuth(agent.post(url)),
            put: (url: string) => withAuth(agent.put(url)),
            patch: (url: string) => withAuth(agent.patch(url)),
            delete: (url: string) => withAuth(agent.delete(url)),
        }
    }

    const live = (workspaceId: string) =>
        ctx.prisma.memberAutopay.findMany({
            where: { workspaceId, status: { in: ['ACTIVE', 'NEEDS_ACTION'] } },
        })

    it('lets a member whose access ran out see and refuse autopay; the token is gone for good', async () => {
        const s = await setup({ memberAccessUntil: new Date(Date.now() - DAY) })
        await enableAutopay(s)
        const { autopay } = await agreeAutopay(s)

        // Expired access still locks the rest of the club.
        const locked = await http(s.memberActor).get(`/workspaces/${s.workspace.id}/me/subscription`)
        expect(locked.status).toBe(403)

        const list = await http(s.memberActor).get(`/workspaces/${s.workspace.id}/me/autopays`)
        expect(list.status).toBe(200)
        expect(list.body.data).toHaveLength(1)
        expect(list.body.data[0]).toMatchObject({
            id: autopay.id,
            status: 'ACTIVE',
            cardLabel: 'карта •• 4444',
            termsAmount: 4000,
            newTerms: null,
            nextCharge: { amount: 4000, kind: 'term' },
        })
        expect(JSON.stringify(list.body)).not.toContain('pm-e2e-0001')

        const cancelled = await http(s.memberActor).post(
            `/workspaces/${s.workspace.id}/me/autopays/${autopay.id}/cancel`,
        )
        expect(cancelled.status).toBe(201)
        expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelSource: 'MEMBER', nextCharge: null })
        const row = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: autopay.id } })
        expect(row.paymentMethodId).toBeNull()
        expect(row.liveKey).toBeNull()

        // Idempotent, and the confirmation stays visible.
        const again = await http(s.memberActor).post(
            `/workspaces/${s.workspace.id}/me/autopays/${autopay.id}/cancel`,
        )
        expect(again.status).toBe(201)
        expect(again.body.status).toBe('CANCELLED')
        const after = await http(s.memberActor).get(`/workspaces/${s.workspace.id}/me/autopays`)
        expect(after.body.data.map((a: { status: string }) => a.status)).toEqual(['CANCELLED'])
        const audit = await ctx.prisma.auditEvent.findFirst({
            where: { workspaceId: s.workspace.id, action: 'autopay.cancelled' },
        })
        expect(audit).not.toBeNull()
    })

    it('never shows or cancels another member’s agreement', async () => {
        const s = await setup()
        await enableAutopay(s)
        const { autopay } = await agreeAutopay(s)
        const { user: other } = await addMember(ctx, { workspaceId: s.workspace.id })
        const otherActor = await signIn(ctx, other.email)
        const list = await http(otherActor).get(`/workspaces/${s.workspace.id}/me/autopays`)
        expect(list.body.data).toEqual([])
        const cancel = await http(otherActor).post(
            `/workspaces/${s.workspace.id}/me/autopays/${autopay.id}/cancel`,
        )
        expect(cancel.status).toBe(404)
        expect((await live(s.workspace.id)).map((a) => a.id)).toEqual([autopay.id])
    })

    it('holds a price rise until the member accepts exactly what the screen showed', async () => {
        const s = await setup()
        await enableAutopay(s)
        const { autopay } = await agreeAutopay(s)
        const rise = await http(s.ownerActor)
            .patch(`/workspaces/${s.workspace.id}/plans/${s.plan.id}`)
            .send({ price: 4500 })
        expect(rise.status).toBe(200)

        const shown = await http(s.memberActor).get(`/workspaces/${s.workspace.id}/me/autopays`)
        const a = shown.body.data[0]
        expect(a.nextCharge).toBeNull()
        expect(a.newTerms).toEqual({
            amount: 4500,
            durationDays: 30,
            classCount: null,
            consentVersion: AUTOPAY_CONSENT_VERSION,
        })
        const url = `/workspaces/${s.workspace.id}/me/autopays/${autopay.id}/accept-terms`

        const stale = await http(s.memberActor)
            .post(url)
            .send({ ...a.newTerms, consentVersion: '2000-01-01' })
        expect(stale.status).toBe(400)
        const changed = await http(s.memberActor)
            .post(url)
            .send({ ...a.newTerms, amount: 4200 })
        expect(changed.status).toBe(409)
        expect(changed.body.message).toBe('Условия снова изменились — обновите экран')

        const accepted = await http(s.memberActor).post(url).send(a.newTerms)
        expect(accepted.status).toBe(201)
        expect(accepted.body).toMatchObject({
            status: 'ACTIVE',
            termsAmount: 4500,
            newTerms: null,
            nextCharge: { amount: 4500 },
        })
        // Nothing left to accept.
        const twice = await http(s.memberActor).post(url).send(a.newTerms)
        expect(twice.status).toBe(409)
    })

    it('shows staff the state on the member card: money and card for club admins only; a coach is refused', async () => {
        const s = await setup()
        await enableAutopay(s)
        await agreeAutopay(s)
        const url = `/workspaces/${s.workspace.id}/members/${s.memberUser.id}/autopays`

        const asOwner = await http(s.ownerActor).get(url)
        expect(asOwner.status).toBe(200)
        expect(asOwner.body.data[0]).toMatchObject({
            cardLabel: 'карта •• 4444',
            termsAmount: 4000,
            nextCharge: { amount: 4000 },
        })

        const asHeadCoach = await http(s.headCoachActor).get(url)
        expect(asHeadCoach.status).toBe(200)
        expect(asHeadCoach.body.data[0]).toMatchObject({
            status: 'ACTIVE',
            cardLabel: null,
            termsAmount: null,
            nextCharge: { amount: null, kind: 'term' },
        })
        expect(JSON.stringify(asHeadCoach.body)).not.toContain('4444')

        expect((await http(s.coachActor).get(url)).status).toBe(403)
    })

    it('lets a head coach cancel at the member’s request with a reason; a coach gets 403', async () => {
        const s = await setup()
        await enableAutopay(s)
        const { autopay } = await agreeAutopay(s)
        const url = `/workspaces/${s.workspace.id}/autopays/${autopay.id}/cancel`

        const coach = await http(s.coachActor).post(url).send({ reason: 'Попросил' })
        expect(coach.status).toBe(403)
        const noReason = await http(s.headCoachActor).post(url).send({ reason: '' })
        expect(noReason.status).toBe(400)

        const done = await http(s.headCoachActor).post(url).send({ reason: 'Попросил по телефону' })
        expect(done.status).toBe(201)
        expect(done.body).toMatchObject({
            status: 'CANCELLED',
            cancelSource: 'STAFF',
            cancelReason: 'Попросил по телефону',
            cancelledBy: { userId: expect.any(String) },
            termsAmount: null,
        })
        const row = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: autopay.id } })
        expect(row.paymentMethodId).toBeNull()
        // The member reads the reason.
        const mine = await http(s.memberActor).get(`/workspaces/${s.workspace.id}/me/autopays`)
        expect(mine.body.data[0]).toMatchObject({ cancelSource: 'STAFF', cancelReason: 'Попросил по телефону' })
    })

    it('refuses the club toggle for Stripe and while the global switch is off', async () => {
        const s = await setup()
        const stripe = await http(s.ownerActor)
            .put(`/workspaces/${s.workspace.id}/payment-settings`)
            .send({
                provider: 'STRIPE',
                secretKey: 'sk_test_12345678',
                webhookSecret: 'whsec_e2e_signing',
                autopayEnabled: true,
            })
        expect(stripe.status).toBe(400)
        expect(stripe.body.message).toBe('Автоплатежи доступны только с ЮKassa')

        environment.memberAutopay.enabled = false
        const off = await http(s.ownerActor)
            .put(`/workspaces/${s.workspace.id}/payment-settings`)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'test_secret_0001', autopayEnabled: true })
        expect(off.status).toBe(400)
        const view = await http(s.ownerActor).get(`/workspaces/${s.workspace.id}/payment-settings`)
        expect(view.body).toMatchObject({ autopayOffered: false, autopayEnabled: false })
    })

    it('gates the tariff box on online sale and the club setting', async () => {
        const s = await setup()
        const url = `/workspaces/${s.workspace.id}/plans/${s.plan.id}`
        const offline = await http(s.ownerActor).patch(url).send({ autopayAvailable: true })
        expect(offline.status).toBe(400)
        const clubOff = await http(s.ownerActor)
            .patch(url)
            .send({ purchasableOnline: true, autopayAvailable: true })
        expect(clubOff.status).toBe(400)
        expect(clubOff.body.message).toBe('Включите автоплатежи в разделе «Онлайн-оплата»')
        await enableAutopay(s)
        const page = await http(s.ownerActor).get(url)
        expect(page.body).toMatchObject({ plan: { autopayAvailable: true }, autopayCount: 0 })
        // A head coach never edits tariffs.
        expect((await http(s.headCoachActor).patch(url).send({ autopayAvailable: false })).status).toBe(403)
    })

    it.each([
        ['the tariff box is unticked', 'plan'],
        ['the club turns autopay off', 'settings'],
        ['payments are disconnected', 'disconnect'],
        ['the member is removed', 'remove'],
    ])('cancels live agreements when %s', async (_case, how) => {
        const s = await setup()
        await enableAutopay(s)
        const { autopay } = await agreeAutopay(s)
        const page = await http(s.ownerActor).get(`/workspaces/${s.workspace.id}/plans/${s.plan.id}`)
        expect(page.body.autopayCount).toBe(1)
        const before = await http(s.ownerActor).get(`/workspaces/${s.workspace.id}/payment-settings`)
        expect(before.body.autopayLiveCount).toBe(1)

        const res =
            how === 'plan'
                ? await http(s.ownerActor)
                      .patch(`/workspaces/${s.workspace.id}/plans/${s.plan.id}`)
                      .send({ autopayAvailable: false })
                : how === 'settings'
                  ? await http(s.ownerActor)
                        .put(`/workspaces/${s.workspace.id}/payment-settings`)
                        .send({ provider: 'YOOKASSA', autopayEnabled: false })
                  : how === 'disconnect'
                    ? await http(s.ownerActor).delete(`/workspaces/${s.workspace.id}/payment-settings`)
                    : await http(s.ownerActor).delete(
                          `/workspaces/${s.workspace.id}/members/${s.memberUser.id}`,
                      )
        expect(res.status).toBe(200)
        const row = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: autopay.id } })
        expect(row).toMatchObject({ status: 'CANCELLED', cancelSource: 'SYSTEM', paymentMethodId: null })
        expect(row.cancelReason).toBeTruthy()
    })

    it('lists a failed autopay beside the debts in «Продлить» without counting it as a debt', async () => {
        const s = await setup()
        await enableAutopay(s)
        await agreeAutopay(s, {
            status: 'NEEDS_ACTION',
            needsActionReason: 'CHARGE_FAILED',
            failedAttempts: 4,
            lastError: 'недостаточно средств на карте',
        })
        const res = await http(s.headCoachActor).get(`/workspaces/${s.workspace.id}/awaiting-payment`)
        expect(res.status).toBe(200)
        expect(res.body.total).toBe(0)
        expect(res.body.members).toBe(0)
        expect(res.body.autopayAttention).toEqual({
            total: 1,
            data: [
                expect.objectContaining({
                    member: expect.objectContaining({ userId: s.memberUser.id }),
                    planName: 'Безлимит',
                    reason: 'CHARGE_FAILED',
                    lastError: 'недостаточно средств на карте',
                    nextAttemptOn: null,
                }),
            ],
        })
        expect(JSON.stringify(res.body.autopayAttention)).not.toMatch(/amount/)
        expect((await http(s.coachActor).get(`/workspaces/${s.workspace.id}/awaiting-payment`)).status).toBe(403)
    })

    it('marks only the renewal charge as autopay in the journal, its detail, the CSV and the abonement', async () => {
        const s = await setup()
        await enableAutopay(s)
        const { autopay, sub: setupSub } = await agreeAutopay(s)
        // The renewal the job charged: back-to-back, no consent version.
        const renewal = await ctx.prisma.subscription.create({
            data: {
                workspaceId: s.workspace.id,
                workspaceMemberId: s.member.id,
                userId: s.memberUser.id,
                planId: s.plan.id,
                status: 'ACTIVE',
                startDate: setupSub.endDate,
                endDate: new Date((setupSub.endDate as Date).getTime() + 30 * DAY),
                durationDays: 30,
                amountPaid: 4000,
                listPrice: 4000,
                currency: 'RUB',
                isPaid: true,
                paidAt: new Date(),
                paymentMethod: 'ONLINE',
                source: 'GATEWAY',
            },
        })
        await ctx.prisma.payment.create({
            data: {
                workspaceId: s.workspace.id,
                userId: s.memberUser.id,
                planId: s.plan.id,
                planName: s.plan.name,
                provider: 'YOOKASSA',
                providerPaymentId: 'yk-charge-0001',
                status: 'SUCCEEDED',
                amount: 4000,
                currency: 'RUB',
                idempotenceKey: `autopay:${setupSub.id}:0`,
                subscriptionId: renewal.id,
                autopayId: autopay.id,
                paidAt: new Date(),
            },
        })

        const journal = await http(s.ownerActor).get(`/workspaces/${s.workspace.id}/payment-journal`)
        expect(journal.status).toBe(200)
        const bySub = new Map(
            journal.body.data.map((e: { subscriptionId: string; online: { autopay: boolean } }) => [
                e.subscriptionId,
                e.online?.autopay,
            ]),
        )
        expect(bySub.get(setupSub.id)).toBe(false)
        expect(bySub.get(renewal.id)).toBe(true)

        const detail = (subId: string) =>
            http(s.ownerActor).get(`/workspaces/${s.workspace.id}/payment-journal/sub:${subId}`)
        expect((await detail(renewal.id)).body.cardLabel).toBe('карта •• 4444')
        expect((await detail(setupSub.id)).body.cardLabel).toBeNull()

        const csv = await http(s.ownerActor).get(`/workspaces/${s.workspace.id}/exports/payments.csv`)
        expect(csv.status).toBe(200)
        expect(csv.text.match(/Онлайн \(автоплатёж\)/g)).toHaveLength(1)

        const abonements = await http(s.headCoachActor).get(
            `/workspaces/${s.workspace.id}/members/${s.memberUser.id}/subscriptions`,
        )
        expect(abonements.status).toBe(200)
        const paid = new Map(
            abonements.body.history.map((a: { id: string; paidByAutopay: boolean }) => [a.id, a.paidByAutopay]),
        )
        expect(paid.get(renewal.id)).toBe(true)
        expect(paid.get(setupSub.id)).toBe(false)
    })
})
