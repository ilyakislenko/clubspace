import { createTestApp, TestApp } from '../support/test-app'

// This endpoint already had a passing unit spec while being broken in the app.
// The controller returned the right object, and the global DefaultErrorFilter
// then rewrote the response body into its own shape and dropped the `checks`
// map — so a failing probe answered "Http Exception" and never said which
// dependency was down, which is the endpoint's entire reason to exist.
//
// Only a test that goes through the real filter can see that, which is why
// these assertions live here and not next to the controller.
describe('readiness probe', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    afterEach(() => {
        ctx.mail.clear()
    })

    it('reports every dependency by name when healthy', async () => {
        const res = await ctx.http().get('/readyz').expect(200)

        expect(res.body.status).toBe('ok')
        expect(res.body.checks).toEqual({ db: 'ok', redis: 'ok', smtp: 'ok' })
    })

    it('answers 503 and names the broken dependency', async () => {
        ctx.mail.transportHealthy = false

        const res = await ctx.http().get('/readyz').expect(503)

        expect(res.body.status).toBe('not_ready')
        expect(res.body.checks.smtp).not.toBe('ok')
        // The detail survives the global error filter. This is the assertion
        // the unit spec could not make.
        expect(res.body.checks.db).toBe('ok')
        expect(res.body.checks.redis).toBe('ok')
    })

    it('recovers once the dependency comes back', async () => {
        ctx.mail.transportHealthy = false
        await ctx.http().get('/readyz').expect(503)

        ctx.mail.transportHealthy = true
        await ctx.http().get('/readyz').expect(200)
    })

    // Liveness must not consult dependencies: if it did, a broken SMTP host
    // would make the orchestrator kill and restart a container that is running
    // perfectly well, turning a degraded feature into an outage loop.
    it('keeps healthz dumb — SMTP down does not make the process unhealthy', async () => {
        ctx.mail.transportHealthy = false

        await ctx.http().get('/healthz').expect(200, { status: 'ok' })
    })
})
