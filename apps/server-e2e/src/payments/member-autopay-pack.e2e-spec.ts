import { AUTOPAY_CONSENT_VERSION } from '../../../server/src/domains/autopay/autopay-consent'
import { MemberAutopayService } from '../../../server/src/domains/autopay/member-autopay.service'
import { addDaysYmd } from '../../../server/src/domains/subscriptions/freeze-dates'
import { environment } from '../../../server/src/environments/environment'
import {
    localDateInTz,
    wallClockToUtc,
} from '../../../server/src/features/attendance/attendance-utils'
import { signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Member autopay of a class pack (docs/design/2026-11-15-member-autopay.md §1):
// charged ≥ 1 h after the last class is used, or at the term end; never while
// classes remain and the term runs. The deduction is written the way the
// check-in writes it (classesRemaining − 1 and a consumed AttendanceRecord);
// the pass reads only those.
describe('member autopay — class pack', () => {
    let ctx: TestApp
    const gateway = new FakeGateway()
    const env = environment as { memberAutopay: { enabled: boolean } }
    let wasEnabled: boolean

    beforeAll(async () => {
        wasEnabled = env.memberAutopay.enabled
        env.memberAutopay.enabled = true
        ctx = await createTestApp({ paymentGateway: gateway })
    })
    afterAll(async () => {
        env.memberAutopay.enabled = wasEnabled
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        gateway.reset()
    })

    const pass = () => ctx.app.get(MemberAutopayService)
    const at = (ymd: string, hm: string, tz: string) => wallClockToUtc(`${ymd}T${hm}`, tz)
    const charges = () => gateway.created.filter((c) => c.input.paymentMethodId)

    // A member on autopay for «8 занятий» (30 days), bought with the switch on.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Студия' })
        const { user: member } = await addMember(ctx, { workspaceId: workspace.id })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: '8 занятий',
            price: 3000,
            classCount: 8,
            durationDays: 30,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, member.email)
        await ctx
            .http()
            .put(`/workspaces/${workspace.id}/payment-settings`)
            .set(...ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)
        await ctx.prisma.workspacePaymentSettings.update({
            where: { workspaceId: workspace.id },
            data: { autopayEnabled: true },
        })
        await ctx.prisma.plan.update({
            where: { id: plan.id },
            data: { purchasableOnline: true, autopayAvailable: true },
        })
        const created = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/payments`)
            .set(...memberActor.auth)
            .send({
                planId: plan.id,
                autopay: true,
                autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
                autopayRenewalAmount: 3000,
            })
            .expect(201)
        const providerId = (
            await ctx.prisma.payment.findUniqueOrThrow({ where: { id: created.body.payment.id } })
        ).providerPaymentId as string
        gateway.setStatus(providerId, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: providerId } })
            .expect(200)
        const pack = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id, userId: member.id },
        })
        const agreement = await ctx.prisma.memberAutopay.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        expect(agreement).toMatchObject({ termsClassCount: 8, termsAmount: 3000, status: 'ACTIVE' })
        const tz = (await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } }))
            .timezone
        return { workspace, owner, member, plan, pack, agreement, tz }
    }

    type Setup = Awaited<ReturnType<typeof setup>>

    // One class checked in at `markedAt`: the pack's balance and the
    // AttendanceRecord that deducted it, as the check-in writes them.
    const checkIn = async (s: Setup, markedAt: Date, remaining: number) => {
        const session = await ctx.prisma.attendanceSession.create({
            data: {
                workspaceId: s.workspace.id,
                occurrenceKey: `e2e:${markedAt.toISOString()}:${Math.random()}`,
                title: 'Тренировка',
                startAt: markedAt,
                timezone: s.tz,
                createdById: s.owner.id,
            },
        })
        const record = await ctx.prisma.attendanceRecord.create({
            data: {
                sessionId: session.id,
                workspaceId: s.workspace.id,
                userId: s.member.id,
                markedById: s.owner.id,
                markedAt,
                consumedSubscriptionId: s.pack.id,
            },
        })
        await ctx.prisma.subscription.update({
            where: { id: s.pack.id },
            data: { classesRemaining: remaining },
        })
        return record
    }

    it('tells the member when one class is left, then charges 1 h after the last one — a new pack from now', async () => {
        const s = await setup()
        const S = localDateInTz(s.pack.endDate as Date, s.tz)
        const day = addDaysYmd(S, -10)
        await checkIn(s, at(day, '11:00', s.tz), 1)
        await pass().runReminders(at(day, '11:40', s.tz))
        const lowNotices = (await ctx.prisma.notification.findMany({ where: { userId: s.member.id } })).filter(
            (n) => n.message.startsWith('Осталось одно занятие'),
        )
        expect(lowNotices).toHaveLength(1)
        // Classes remain and the term runs: never charged.
        expect(await pass().runCharges(at(day, '12:40', s.tz))).toEqual({ SKIPPED: 1 })

        const last = at(day, '18:00', s.tz)
        await checkIn(s, last, 0)
        expect(await pass().runCharges(at(day, '18:40', s.tz))).toEqual({ SKIPPED: 1 })
        expect(charges()).toHaveLength(0)
        const due = at(day, '19:10', s.tz)
        expect(await pass().runCharges(due)).toEqual({ CHARGED: 1 })
        expect(charges()[0].input).toMatchObject({ amount: 3000, paymentMethodId: 'pm_yk_1' })
        const subs = await ctx.prisma.subscription.findMany({
            where: { userId: s.member.id },
            orderBy: { createdAt: 'asc' },
        })
        expect(subs).toHaveLength(2)
        expect(subs[1]).toMatchObject({ classesTotal: 8, classesRemaining: 8, source: 'GATEWAY' })
        // Starts at the charge, not at the old pack's end.
        expect(subs[1].startDate?.getTime()).toBeLessThan(at(addDaysYmd(day, 1), '00:00', s.tz).getTime())
        expect(subs[1].startDate?.getTime()).toBeGreaterThanOrEqual(at(day, '00:00', s.tz).getTime())
    })

    it('a class unmarked within the hour stops the charge', async () => {
        const s = await setup()
        const S = localDateInTz(s.pack.endDate as Date, s.tz)
        const day = addDaysYmd(S, -10)
        const record = await checkIn(s, at(day, '12:00', s.tz), 0)
        // The coach undoes the mark: the class goes back, the record loses it.
        await ctx.prisma.attendanceRecord.update({
            where: { id: record.id },
            data: { consumedSubscriptionId: null },
        })
        await ctx.prisma.subscription.update({ where: { id: s.pack.id }, data: { classesRemaining: 1 } })
        expect(await pass().runCharges(at(day, '13:40', s.tz))).toEqual({ SKIPPED: 1 })
        expect(charges()).toHaveLength(0)
    })

    it('charges at the term end (S 10:00) when classes are left; the unused ones lapse', async () => {
        const s = await setup()
        const S = localDateInTz(s.pack.endDate as Date, s.tz)
        // The pack ends before 10:00 on S, whatever time the suite runs.
        await ctx.prisma.subscription.update({ where: { id: s.pack.id }, data: { endDate: at(S, '06:00', s.tz) } })
        await checkIn(s, at(addDaysYmd(S, -20), '12:00', s.tz), 5)
        expect(await pass().runCharges(at(addDaysYmd(S, -1), '12:00', s.tz))).toEqual({ SKIPPED: 1 })
        expect(await pass().runCharges(at(S, '09:40', s.tz))).toEqual({ SKIPPED: 1 })
        expect(await pass().runCharges(at(S, '10:40', s.tz))).toEqual({ CHARGED: 1 })
        const subs = await ctx.prisma.subscription.findMany({
            where: { userId: s.member.id },
            orderBy: { createdAt: 'asc' },
        })
        expect(subs).toHaveLength(2)
        expect(subs[1]).toMatchObject({ classesRemaining: 8 })
        // A repeated pass charges nothing more.
        await pass().runCharges(at(S, '11:40', s.tz))
        expect(charges()).toHaveLength(1)
    })

    it('a pack with classes left that ends later on S is charged after it ends, never over it', async () => {
        const s = await setup()
        const S = localDateInTz(s.pack.endDate as Date, s.tz)
        await ctx.prisma.subscription.update({ where: { id: s.pack.id }, data: { endDate: at(S, '15:00', s.tz) } })
        await checkIn(s, at(addDaysYmd(S, -20), '12:00', s.tz), 5)
        // Live with classes at 10:40: a new pack can't be granted over it.
        expect(await pass().runCharges(at(S, '10:40', s.tz))).toEqual({ SKIPPED: 1 })
        expect(charges()).toHaveLength(0)
        expect(await pass().runCharges(at(S, '15:40', s.tz))).toEqual({ CHARGED: 1 })
        const subs = await ctx.prisma.subscription.findMany({
            where: { userId: s.member.id },
            orderBy: { createdAt: 'asc' },
        })
        expect(subs).toHaveLength(2)
        expect(subs[1]).toMatchObject({ classesRemaining: 8, source: 'GATEWAY' })
    })
})
