import type { TestApp } from './test-app'

export type Actor = {
    userId: string
    email: string
    accessToken: string
    refreshToken: string
    /** `Authorization: Bearer …`, ready to hand to supertest's .set(). */
    auth: [string, string]
}

/**
 * Signs a user in the way a real client does: request a code, read it out of
 * the email that was actually rendered and dispatched, post it back.
 *
 * Nothing is stubbed along the way. A shortcut that minted a JWT directly
 * would be faster and would keep passing if OTP issuance, the event listener,
 * the notification feature or the email template broke — which is precisely
 * the chain that has broken before and stayed invisible until a human
 * couldn't log in.
 *
 * Then it accepts the personal-data consent through the same screen-facing
 * endpoints the apps use, because every other route refuses an account
 * without it. Pass `acceptConsent: false` to stay in front of the gate.
 */
export const signIn = async (
    ctx: TestApp,
    email: string,
    options: { workspaceKey?: string; acceptConsent?: boolean } = {},
): Promise<Actor> => {
    await ctx
        .http()
        .post('/send-auth-code')
        .send({ email, ...(options.workspaceKey ? { workspaceKey: options.workspaceKey } : {}) })
        .expect(201)

    const code = await ctx.mail.waitForCodeTo(email)

    const res = await ctx.http().post('/sign-in').send({ email, code })
    if (res.status !== 201) {
        throw new Error(
            `sign-in for ${email} failed with ${res.status}: ${JSON.stringify(
                res.body,
            )}`,
        )
    }

    const actor: Actor = {
        userId: res.body.userId,
        email,
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        auth: ['Authorization', `Bearer ${res.body.accessToken}`],
    }
    if (options.acceptConsent !== false) {
        await acceptConsent(ctx, actor)
    }
    return actor
}

/** Accepts the current consent edition the way the consent screen does. */
export const acceptConsent = async (ctx: TestApp, actor: Actor) => {
    const status = await ctx
        .http()
        .get('/me/consent')
        .set(...actor.auth)
        .expect(200)
    if (!status.body.required) return
    await ctx
        .http()
        .post('/me/consent')
        .set(...actor.auth)
        .send({ version: status.body.currentVersion })
        .expect(201)
}

/**
 * Issuing a code writes completeCodeNextResendAt, and a second request inside
 * that window is refused. Specs that sign the same address in twice (e.g. to
 * check a token refresh) need the cooldown cleared rather than a sleep.
 */
export const clearResendCooldown = async (ctx: TestApp, email: string) => {
    await ctx.prisma.user.update({
        where: { email },
        data: { completeCodeNextResendAt: null },
    })
}
