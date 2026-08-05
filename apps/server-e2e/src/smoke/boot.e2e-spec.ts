import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

describe('boot', () => {
    let ctx: TestApp
    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })

    it('boots and answers healthz', async () => {
        await ctx.http().get('/healthz').expect(200, { status: 'ok' })
    })

    it('truncates cleanly', async () => {
        await resetDatabase(ctx.prisma)
        expect(await ctx.prisma.user.count()).toBe(0)
    })
})
