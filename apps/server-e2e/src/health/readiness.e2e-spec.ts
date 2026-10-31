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
        jest.restoreAllMocks()
    })

    // A good SMTP check is reused for a minute (the probe is public, and each
    // check is a login to the relay). Specs about a failing relay move the
    // clock past that window instead of sleeping through it.
    const realNow = Date.now.bind(Date)
    const expireSmtpCache = () =>
        jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 61_000)

    it('reports every dependency by name when healthy', async () => {
        const res = await ctx.http().get('/readyz').expect(200)

        expect(res.body.status).toBe('ok')
        expect(res.body.checks.db).toBe('ok')
        expect(res.body.checks.redis).toBe('ok')
        expect(res.body.checks.smtp).toBe('ok')
    })

    // Only that the queue is reported and never fails readiness — a missing
    // transcoder degrades video processing, it does not make the API unfit to
    // serve. Deliberately not asserting "no consumers": getWorkers() is
    // CLIENT LIST, which is server-wide and ignores the db this suite isolates
    // itself with, so a `npm run dev` worker in another terminal would answer
    // this probe and turn the assertion into a flake.
    it('reports the transcode queue without failing readiness', async () => {
        const res = await ctx.http().get('/readyz').expect(200)

        expect(res.body.status).toBe('ok')
        expect(typeof res.body.checks.videoWorker).toBe('string')
    })

    it('reuses a good SMTP check for a minute', async () => {
        await ctx.http().get('/readyz').expect(200)
        ctx.mail.transportHealthy = false

        // Inside the window: the cached verdict, no new SMTP login.
        await ctx.http().get('/readyz').expect(200)

        expireSmtpCache()
        await ctx.http().get('/readyz').expect(503)
    })

    it('answers 503 and names the broken dependency', async () => {
        expireSmtpCache()
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
        expireSmtpCache()
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
