// The real TFA services pull in otplib (ESM-only); the guard gets stubs.
jest.mock('../../domains/tfa/services/tfa-authenticator.service', () => ({
    TfaAuthenticatorService: class {},
}))
jest.mock('../../domains/tfa/services/tfa.service', () => ({
    TfaService: class {},
}))

import { UnauthorizedError } from '../errors/shared.errors'
import { TfaCodeRequiredError, TfaGuard } from './tfa.guard'

const tfaMethod = {
    type: 'TOTP',
    tfaPermissions: [{ group: { key: 'auth', alwaysEnabled: true }, enabled: true }],
}

const build = (opts: { user?: { id: string } | null; methods?: unknown[] }) => {
    const users = {
        getUserByEmail: jest.fn().mockResolvedValue(opts.user ?? null),
    }
    const tokens = { verifyToken: jest.fn().mockRejectedValue(new Error('bad')) }
    const tfa = {
        getTfaMethods: jest.fn().mockResolvedValue(opts.methods ?? []),
    }
    const guard = new TfaGuard(
        users as never,
        tokens as never,
        { get: () => 'auth' } as never,
        { verifyCode: jest.fn() } as never,
        tfa as never,
    )
    return { guard, tfa }
}

const context = (body: unknown) => {
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
    }
    return {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => () => undefined,
    } as never
}

describe('TfaGuard on sign-in', () => {
    // Refusing here would answer an unknown address differently from a known
    // one — the handler gives both the same reply.
    it('lets an e-mail without an account through to the handler', async () => {
        const { guard, tfa } = build({ user: null })
        await expect(
            guard.canActivate(context({ email: 'nobody@x.io' })),
        ).resolves.toBeDefined()
        expect(tfa.getTfaMethods).not.toHaveBeenCalled()
    })

    it('passes a known account without a second factor', async () => {
        const { guard } = build({ user: { id: 'u1' } })
        await expect(
            guard.canActivate(context({ email: 'a@b.com' })),
        ).resolves.toBeDefined()
    })

    it('asks a known account with a second factor for its code', async () => {
        const { guard } = build({ user: { id: 'u1' }, methods: [tfaMethod] })
        await expect(
            guard.canActivate(context({ email: 'a@b.com' })),
        ).rejects.toBeInstanceOf(TfaCodeRequiredError)
    })

    it('refuses a request that names no identity at all', async () => {
        const { guard } = build({})
        await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(
            UnauthorizedError,
        )
    })
})
