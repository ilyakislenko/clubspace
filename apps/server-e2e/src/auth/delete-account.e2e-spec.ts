import { signIn } from '../support/actors'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// A valid access token alone must not erase an account: deletion takes a
// fresh code mailed to the account's own address, checked like at sign-in.
describe('account deletion (re-authentication)', () => {
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

    it('refuses without a code, counts a wrong one, deletes with the mailed one', async () => {
        const actor = await signIn(ctx, 'leaving@example.com')
        const status = async () =>
            (
                await ctx.prisma.user.findUniqueOrThrow({
                    where: { id: actor.userId },
                    select: { status: true },
                })
            ).status

        await ctx
            .http()
            .post('/me/delete-account')
            .set(...actor.auth)
            .send({})
            .expect(400)
        // The sign-in code was burnt: nothing to delete with yet.
        await ctx
            .http()
            .post('/me/delete-account')
            .set(...actor.auth)
            .send({ code: '000000' })
            .expect(400)
        expect(await status()).toBe('ACTIVE')

        ctx.mail.clear()
        await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: actor.email })
            .expect(201)
        const code = await ctx.mail.waitForCodeTo(actor.email)
        const wrong = code === '111111' ? '222222' : '111111'

        await ctx
            .http()
            .post('/me/delete-account')
            .set(...actor.auth)
            .send({ code: wrong })
            .expect(400)
        const user = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: actor.userId },
            select: { status: true, signInFailedAttempts: true },
        })
        expect(user).toEqual({ status: 'ACTIVE', signInFailedAttempts: 1 })

        await ctx
            .http()
            .post('/me/delete-account')
            .set(...actor.auth)
            .send({ code })
            .expect(200, { status: 'deleted' })
        expect(await status()).toBe('DELETED')
    })
})
