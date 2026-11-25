import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Join-code alphabet has no I/L/O/0/1.
const CODE = 'PAYK2345'
const MOM = 'mom-pays@example.com'
const DAD = 'dad-pays@example.com'

// A guardian buys a child's abonement online in the child's profile
// (docs/design/2026-11-26-parent-pays-for-child.md): the child holds it, the
// guardian pays — receipt e-mail, Payment.payerUserId, the audit actor, the
// journal's «Оплатил(а)» and the CSV's «Плательщик» — and autopay stays off
// for a child. Real guards, handlers and Postgres; only the provider is fake.
describe('online payment of a child’s abonement by a guardian', () => {
    let ctx: TestApp
    const gateway = new FakeGateway()

    beforeAll(async () => {
        ctx = await createTestApp({ paymentGateway: gateway })
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        gateway.reset()
    })

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Kids BJJ' })
        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { joinAutoApprove: true },
        })
        await ctx.prisma.workspaceJoinCode.create({ data: { workspaceId: workspace.id, code: CODE } })
        const ownerActor = await signIn(ctx, owner.email as string)
        await ctx
            .http()
            .put(`/workspaces/${workspace.id}/payment-settings`)
            .set(...ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Детский безлимит',
            price: 4000,
            classCount: null,
            durationDays: 30,
        })
        await ctx
            .http()
            .patch(`/workspaces/${workspace.id}/plans/${plan.id}`)
            .set(...ownerActor.auth)
            .send({ purchasableOnline: true })
            .expect(200)

        const mom = await signIn(ctx, MOM)
        await ctx.prisma.user.update({
            where: { id: mom.userId },
            data: { firstname: 'Елена', lastname: 'Петрова' },
        })
        const child = (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...mom.auth)
                .send({ firstname: 'Миша', lastname: 'Петров', dateOfBirth: '2017-05-04', consent: true })
                .expect(201)
        ).body as { id: string }
        const actAs: [string, string] = ['X-Act-As', child.id]
        await ctx.http().post('/workspaces/join').set(...mom.auth).set(...actAs).send({ code: CODE }).expect(201)
        // Mom trains in the same club herself: «Я» is a member here too.
        await ctx.http().post('/workspaces/join').set(...mom.auth).send({ code: CODE }).expect(201)
        return { workspace, ownerActor, plan, mom, child, actAs }
    }
    type Setup = Awaited<ReturnType<typeof setup>>

    const buy = (s: Setup, actor: Actor, body: Record<string, unknown> = {}) =>
        ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payments`)
            .set(...actor.auth)
            .set(...s.actAs)
            .send({ planId: s.plan.id, ...body })

    const succeed = async (s: Setup, providerPaymentId: string) => {
        gateway.setStatus(providerPaymentId, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${s.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: providerPaymentId } })
            .expect(200)
    }

    // A second confirmed guardian of the same child (the co-parent flow has
    // its own e2e; here only the link matters).
    const addDad = async (s: Setup) => {
        const dad = await signIn(ctx, DAD)
        await ctx.prisma.guardianship.create({
            data: { guardianId: dad.userId, dependentId: s.child.id, consentAt: new Date() },
        })
        return dad
    }

    it('the child holds the abonement, the guardian pays: receipt, audit, return screen, journal, CSV', async () => {
        const s = await setup()

        // «Оплатить онлайн» in the child's profile: the tariffs, no autopay.
        const options = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...s.mom.auth)
            .set(...s.actAs)
            .expect(200)
        expect(options.body).toMatchObject({ available: true, autopayTermsUrl: null })
        expect(options.body.plans).toEqual([
            expect.objectContaining({ id: s.plan.id, amount: 4000, autopay: null }),
        ])
        const quote = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/checkout-quote`)
            .query({ planId: s.plan.id })
            .set(...s.mom.auth)
            .set(...s.actAs)
            .expect(200)
        expect(quote.body).toMatchObject({ amount: 4000, autopay: null })

        const created = await buy(s, s.mom)
        expect(created.status).toBe(201)
        const paymentId = created.body.payment.id as string
        expect(gateway.created).toHaveLength(1)
        expect(gateway.created[0].input).toMatchObject({
            customerEmail: MOM,
            amount: 4000,
            // No child's name goes to the provider.
            description: 'Абонемент «Детский безлимит» — Kids BJJ',
            itemName: 'Абонемент «Детский безлимит»',
        })
        expect(await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
            userId: s.child.id,
            payerUserId: s.mom.userId,
            receiptEmail: MOM,
        })
        // The child's online-purchase block shows mom's pending payment.
        const pending = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...s.mom.auth)
            .set(...s.actAs)
            .expect(200)
        expect(pending.body.pendingPayment).toMatchObject({ id: paymentId })

        await succeed(s, 'yk_1')
        const childMember = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, userId: s.child.id },
        })
        const subs = await ctx.prisma.subscription.findMany({
            where: { workspaceId: s.workspace.id, source: 'GATEWAY' },
        })
        expect(subs).toEqual([
            expect.objectContaining({ workspaceMemberId: childMember.id, userId: s.child.id, isPaid: true }),
        ])
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, action: 'payment.succeeded' },
        })
        expect(audit).toMatchObject({ actorId: s.mom.userId, targetId: s.child.id })
        expect(audit.metadata).toMatchObject({ paymentId, payerUserId: s.mom.userId })

        // Back from the provider's page after switching to «Я»: no header.
        const followed = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${paymentId}`)
            .set(...s.mom.auth)
            .expect(200)
        expect(followed.body).toMatchObject({ id: paymentId, status: 'SUCCEEDED' })
        // A stranger in the club gets nothing.
        const { user: stranger } = await addMember(ctx, { workspaceId: s.workspace.id })
        const strangerActor = await signIn(ctx, stranger.email as string)
        await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${paymentId}`)
            .set(...strangerActor.auth)
            .expect(404)

        // The journal names the payer on the sale, list and panel alike.
        const entryId = `sub:${subs[0].id}`
        const list = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/payment-journal`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(list.body.data.find((r: { id: string }) => r.id === entryId)).toMatchObject({
            member: { userId: s.child.id, name: 'Миша Петров' },
            payer: { userId: s.mom.userId, name: 'Елена Петрова' },
        })
        const entry = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/payment-journal/${encodeURIComponent(entryId)}`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(entry.body.payer).toEqual({ userId: s.mom.userId, name: 'Елена Петрова' })

        const csv = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/exports/payments.csv`)
            .set(...s.ownerActor.auth)
            .expect(200)
        const lines = csv.text.split(/\r?\n/)
        expect(lines[0].split(';').at(-1)).toBe('Плательщик')
        const sale = lines.find((l) => l.includes('Детский безлимит'))
        expect(sale?.split(';').at(-1)).toBe('Елена Петрова')
    })

    it('two parents: each gets their own provider page and receipt; a repeated tap reuses one’s own', async () => {
        const s = await setup()
        const dad = await addDad(s)

        const momFirst = await buy(s, s.mom).expect(201)
        const momAgain = await buy(s, s.mom).expect(201)
        expect(momAgain.body.payment.id).toBe(momFirst.body.payment.id)
        expect(gateway.created).toHaveLength(1)

        const dadOwn = await buy(s, dad).expect(201)
        expect(dadOwn.body.payment.id).not.toBe(momFirst.body.payment.id)
        expect(dadOwn.body.confirmationUrl).toBe('https://provider.test/confirm/yk_2')
        expect(gateway.created.map((c) => c.input.customerEmail)).toEqual([MOM, DAD])
        expect(
            await ctx.prisma.payment.findUniqueOrThrow({ where: { id: dadOwn.body.payment.id } }),
        ).toMatchObject({ userId: s.child.id, payerUserId: dad.userId, receiptEmail: DAD })
    })

    it('refuses autopay for a child, and a guardian’s refund push reaches both parents', async () => {
        const s = await setup()
        const refused = await buy(s, s.mom, {
            autopay: true,
            autopayConsentVersion: 'v1',
            autopayRenewalAmount: 4000,
        })
        expect(refused.status).toBe(400)
        expect(refused.body.message).toBe(
            'Автоплатёж для абонемента ребёнка не подключается — продлевайте его покупкой',
        )
        expect(gateway.created).toHaveLength(0)
        expect(await ctx.prisma.payment.count({ where: { workspaceId: s.workspace.id } })).toBe(0)

        const dad = await addDad(s)
        const created = await buy(s, s.mom).expect(201)
        await succeed(s, 'yk_1')
        const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: created.body.payment.id } })
        await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/refunds`)
            .set(...s.ownerActor.auth)
            .send({
                target: 'abonement',
                targetId: payment.subscriptionId,
                amount: 4000,
                method: 'ONLINE',
                reason: 'Переезд',
            })
            .expect(201)
        // The refund's receipt goes to the payer's e-mail.
        expect(gateway.refundRequests[0]).toMatchObject({ amount: 4000 })
        const refundedTo = await ctx.prisma.notification.findMany({
            where: { metadata: { path: ['kind'], equals: 'payment.refunded' } },
            select: { userId: true, topic: true },
        })
        expect(refundedTo.map((n) => n.userId).sort()).toEqual([s.mom.userId, dad.userId].sort())
        expect(refundedTo.every((n) => n.topic.startsWith('Миша: '))).toBe(true)
    })
})
