import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// The only suite that boots with the real ThrottlerGuard counter store. Every
// other file swaps it out, because the limits are per client IP and all
// requests here come from the same loopback address — so with it on, specs
// start failing at the eighth request for reasons unrelated to what they
// assert. That trade-off is only honest if rate limiting itself is covered
// somewhere, which is this file.
describe('rate limiting', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp({ rateLimiting: true })
    })
    afterAll(async () => {
        await ctx?.close()
    })

    it('refuses a burst of sign-in code requests', async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()

        // @Throttle on send-auth-code allows 30 per minute per IP — sized so
        // a group signing up together on the club Wi-Fi fits, but still a
        // hard stop for a script. Unauthenticated and it emails whoever is
        // named, so an open one is both a spam cannon and a way to enumerate
        // accounts.
        const statuses: number[] = []
        for (let i = 0; i < 35; i++) {
            const res = await ctx
                .http()
                .post('/send-auth-code')
                .send({ email: `burst${i}@example.com` })
            statuses.push(res.status)
        }

        expect(statuses).toContain(429)
        // The first few must succeed — a limiter that refuses everything would
        // also "contain 429" while being completely broken.
        expect(statuses.slice(0, 3).every((s) => s === 201)).toBe(true)
    })
})
