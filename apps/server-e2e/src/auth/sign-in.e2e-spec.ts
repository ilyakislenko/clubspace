import { clearResendCooldown, signIn } from '../support/actors'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

describe('sign-in (email OTP)', () => {
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

    it('emails a code to a new address without creating an account', async () => {
        const res = await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'newcomer@example.com' })
            .expect(201)

        expect(res.body).toEqual({ sent: true })

        const mail = await ctx.mail.waitFor(
            (m) => m.to === 'newcomer@example.com',
        )
        expect(mail.html).toMatch(/\b\d{6}\b/)
        expect(await ctx.prisma.user.count({
            where: { email: 'newcomer@example.com' },
        })).toBe(0)
    })

    it('creates the account only once the emailed code is entered', async () => {
        await ctx.http().post('/send-auth-code').send({ email: 'proven@example.com' }).expect(201)
        const code = await ctx.mail.waitForCodeTo('proven@example.com')

        const wrong = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'proven@example.com', code: code === '000000' ? '111111' : '000000' })
        expect(wrong.status).toBe(400)
        expect(await ctx.prisma.user.count({ where: { email: 'proven@example.com' } })).toBe(0)

        const res = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'proven@example.com', code })
            .expect(201)
        const user = await ctx.prisma.user.findUniqueOrThrow({
            where: { email: 'proven@example.com' },
        })
        expect(res.body.userId).toBe(user.id)
        expect(await ctx.prisma.pendingSignIn.count()).toBe(0)

        // The code is single-use.
        const replay = await ctx.http().post('/sign-in').send({ email: 'proven@example.com', code })
        expect(replay.status).toBe(400)
    })

    it('locks a new address out after five wrong codes, and creates nothing', async () => {
        await ctx.http().post('/send-auth-code').send({ email: 'guessed@example.com' }).expect(201)
        const code = await ctx.mail.waitForCodeTo('guessed@example.com')
        const wrong = code === '000000' ? '111111' : '000000'

        const statuses: number[] = []
        for (let i = 0; i < 6; i++) {
            const res = await ctx
                .http()
                .post('/sign-in')
                .send({ email: 'guessed@example.com', code: wrong })
            statuses.push(res.status)
        }
        expect(statuses).toEqual([400, 400, 400, 400, 400, 429])

        // Locked: even the right code is refused until the lock runs out.
        const right = await ctx.http().post('/sign-in').send({ email: 'guessed@example.com', code })
        expect(right.status).toBe(429)
        expect(await ctx.prisma.user.count({ where: { email: 'guessed@example.com' } })).toBe(0)
    })

    // No account enumeration: the answer for an existing account is the
    // answer for a new one.
    it('answers an existing account exactly like a new one', async () => {
        await ctx.prisma.user.create({
            data: { email: 'returning@example.com', status: 'ACTIVE', language: 'EN' },
        })

        const existing = await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'returning@example.com' })
            .expect(201)
        const fresh = await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'first-time@example.com' })
            .expect(201)

        expect(existing.status).toBe(fresh.status)
        expect(existing.body).toEqual(fresh.body)

        // A too-early repeat is refused the same way for both.
        const existingAgain = await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'returning@example.com' })
        const freshAgain = await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'first-time@example.com' })
        expect(existingAgain.status).toBe(freshAgain.status)
        expect(existingAgain.body.code).toBe(freshAgain.body.code)
        expect(existingAgain.body.message).toBe(freshAgain.body.message)
        expect(existingAgain.body.metadata).toEqual(freshAgain.body.metadata)
    })

    it('answers sign-in for a requested-but-unknown address like an account', async () => {
        await ctx.prisma.user.create({
            data: { email: 'known@example.com', status: 'ACTIVE', language: 'EN' },
        })
        await ctx.http().post('/send-auth-code').send({ email: 'known@example.com' }).expect(201)
        await ctx.http().post('/send-auth-code').send({ email: 'unknown@example.com' }).expect(201)
        const known = await ctx.http().post('/sign-in').send({ email: 'known@example.com', code: '000001' })
        const unknown = await ctx.http().post('/sign-in').send({ email: 'unknown@example.com', code: '000001' })
        expect(unknown.status).toBe(known.status)
        expect(unknown.body.code).toBe(known.body.code)
        expect(unknown.body.message).toBe(known.body.message)
    })

    it('answers sign-in for an unknown address like an account without a code', async () => {
        await ctx.prisma.user.create({
            data: { email: 'idle@example.com', status: 'ACTIVE', language: 'EN' },
        })

        const unknown = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'ghost@example.com', code: '123456' })
        const known = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'idle@example.com', code: '123456' })

        expect(unknown.status).toBe(known.status)
        expect(unknown.body.code).toBe(known.body.code)
        expect(unknown.body.message).toBe(known.body.message)
        expect(JSON.stringify(unknown.body)).not.toContain('ghost@example.com')
    })

    it('exchanges the emailed code for a usable token pair', async () => {
        const actor = await signIn(ctx, 'member@example.com')

        expect(actor.accessToken).toEqual(expect.any(String))
        expect(actor.refreshToken).toEqual(expect.any(String))

        // The real proof the token works: an authenticated route accepts it.
        const me = await ctx.http().get('/me').set(...actor.auth).expect(200)
        expect(me.body.email).toBe('member@example.com')
    })

    it('rejects a wrong code without issuing tokens', async () => {
        await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'member@example.com' })
            .expect(201)
        await ctx.mail.waitForCodeTo('member@example.com')

        const res = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'member@example.com', code: '000000' })

        expect(res.status).toBe(400)
        expect(res.body.accessToken).toBeUndefined()
    })

    it('rejects a code belonging to a different account', async () => {
        await ctx.http().post('/send-auth-code').send({ email: 'a@example.com' }).expect(201)
        const codeForA = await ctx.mail.waitForCodeTo('a@example.com')

        await ctx.http().post('/send-auth-code').send({ email: 'b@example.com' }).expect(201)
        await ctx.mail.waitForCodeTo('b@example.com')

        const res = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'b@example.com', code: codeForA })

        expect(res.status).toBe(400)
    })

    // The cooldown lives in the database (PendingSignIn for a new address,
    // User.completeCodeNextResendAt for an account), not in the rate limiter, so it still applies with the throttler guard off.
    it('refuses a second code request inside the resend cooldown', async () => {
        await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'impatient@example.com' })
            .expect(201)

        const res = await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'impatient@example.com' })

        expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it('issues a fresh code once the cooldown is cleared, and the old one dies', async () => {
        await ctx.http().post('/send-auth-code').send({ email: 'rotate@example.com' }).expect(201)
        const firstCode = await ctx.mail.waitForCodeTo('rotate@example.com')

        await clearResendCooldown(ctx, 'rotate@example.com')
        ctx.mail.clear()
        await ctx.http().post('/send-auth-code').send({ email: 'rotate@example.com' }).expect(201)
        const secondCode = await ctx.mail.waitForCodeTo('rotate@example.com')

        // Only the latest code is stored, so the superseded one must not work.
        // Without this, a leaked older code would stay valid for its full TTL.
        const stale = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'rotate@example.com', code: firstCode })
        expect(stale.status).toBe(400)

        const fresh = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'rotate@example.com', code: secondCode })
        expect(fresh.status).toBe(201)
    })

    it('rejects a malformed code at the validation layer, not the handler', async () => {
        const res = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'member@example.com', code: '123' })

        expect(res.status).toBe(400)
    })

    it('rejects an unauthenticated call to /me', async () => {
        await ctx.http().get('/me').expect(401)
    })

    it('rejects a garbage bearer token', async () => {
        await ctx
            .http()
            .get('/me')
            .set('Authorization', 'Bearer not-a-jwt')
            .expect(401)
    })
})
