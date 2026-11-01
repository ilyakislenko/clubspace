import { acceptConsent, signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// 152-ФЗ: consent to personal-data processing is its own recorded act, and
// nothing past the consent screen works until the current edition is
// accepted. Booted for real so the guard ordering, the decorator metadata and
// the error filter's body are what is asserted, not mocks of them.
describe('personal-data consent gate', () => {
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

    const memberOfClub = async () => {
        const { workspace } = await createWorkspace(ctx)
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        return { workspace, user }
    }

    it('marks a brand-new account with nothing in it as empty, and lets it go', async () => {
        const actor = await signIn(ctx, 'just-looking@example.com', { acceptConsent: false })
        const status = await ctx.http().get('/me/consent').set(...actor.auth).expect(200)
        expect(status.body.isEmptyAccount).toBe(true)

        // «Не согласен» deletes it through the same pre-consent route.
        await ctx.http().delete('/me').set(...actor.auth).expect(200)
        expect(
            await ctx.prisma.user.count({ where: { email: 'just-looking@example.com' } }),
        ).toBe(0)
    })

    it('refuses club and account routes until the consent is accepted, then lets them through', async () => {
        const { workspace, user } = await memberOfClub()
        const actor = await signIn(ctx, user.email, { acceptConsent: false })

        // The consent screen's own reads work.
        await ctx.http().get('/me').set(...actor.auth).expect(200)
        const status = await ctx
            .http()
            .get('/me/consent')
            .set(...actor.auth)
            .expect(200)
        expect(status.body).toMatchObject({
            kind: 'PERSONAL_DATA',
            acceptedVersion: null,
            acceptedAt: null,
            required: true,
            // A club member has data: no «Не согласен» shortcut.
            isEmptyAccount: false,
        })

        // Everything else is refused with the typed code the apps key on.
        for (const path of [
            `/workspaces/${workspace.id}/about`,
            '/me/notification-preferences',
        ]) {
            const res = await ctx.http().get(path).set(...actor.auth)
            expect(res.status).toBe(403)
            expect(res.body.code).toBe('CONSENT_REQUIRED')
        }

        await ctx
            .http()
            .post('/me/consent')
            .set(...actor.auth)
            .set('User-Agent', 'ClubSpace-e2e/1.0')
            .send({ version: status.body.currentVersion })
            .expect(201)

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/about`)
            .set(...actor.auth)
            .expect(200)

        const records = await ctx.prisma.consentRecord.findMany({
            where: { userId: user.id },
        })
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({
            kind: 'PERSONAL_DATA',
            version: status.body.currentVersion,
            userAgent: 'ClubSpace-e2e/1.0',
            withdrawnAt: null,
        })
        expect(records[0].ip).toEqual(expect.any(String))
    })

    it('refuses to record consent to an edition other than the current one', async () => {
        const { user } = await memberOfClub()
        const actor = await signIn(ctx, user.email, { acceptConsent: false })

        const res = await ctx
            .http()
            .post('/me/consent')
            .set(...actor.auth)
            .send({ version: '1999-01-01' })
        expect(res.status).toBe(409)
        expect(
            await ctx.prisma.consentRecord.count({ where: { userId: user.id } }),
        ).toBe(0)
    })

    it('gates an existing account again when the consent edition changes', async () => {
        const { workspace, user } = await memberOfClub()
        const actor = await signIn(ctx, user.email)
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/about`)
            .set(...actor.auth)
            .expect(200)

        // An account that accepted an older text.
        await ctx.prisma.user.update({
            where: { id: user.id },
            data: { personalDataConsentVersion: '2000-01-01' },
        })
        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/about`)
            .set(...actor.auth)
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('CONSENT_REQUIRED')

        await acceptConsent(ctx, actor)
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/about`)
            .set(...actor.auth)
            .expect(200)
    })

    it('lets an account without consent delete itself, which withdraws the consent', async () => {
        const { user } = await memberOfClub()
        const actor = await signIn(ctx, user.email)
        await ctx.prisma.user.update({
            where: { id: user.id },
            data: { personalDataConsentVersion: null },
        })

        await ctx.http().delete('/me').set(...actor.auth).expect(200)

        const record = await ctx.prisma.consentRecord.findFirstOrThrow({
            where: { userId: user.id },
        })
        expect(record.withdrawnAt).toBeInstanceOf(Date)
        expect(record.ip).toBeNull()
        expect(record.userAgent).toBeNull()
    })

    it('audits every successful sign-in', async () => {
        const { user } = await memberOfClub()
        await signIn(ctx, user.email)

        const events = await ctx.prisma.auditEvent.findMany({
            where: { action: 'auth.signIn', targetId: user.id },
        })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
            actorId: user.id,
            workspaceId: null,
            targetType: 'member',
        })
    })
})
