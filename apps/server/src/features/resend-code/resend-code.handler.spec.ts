// environment.ts reads required env vars at import; stub it so loading the
// handler under test doesn't need the full CI env.
jest.mock('../../environments/environment', () => ({ environment: {} }))

import { ResendCodeHandler } from './resend-code.handler'

describe('ResendCodeHandler', () => {
    const setup = (assertCanSend: jest.Mock) => {
        const users = { createCompleteCode: jest.fn().mockResolvedValue(undefined) }
        const handler = new ResendCodeHandler(
            users as never,
            { assertCanSend } as never,
        )
        return { handler, users }
    }

    it('issues a new code when mail is deliverable', async () => {
        const { handler, users } = setup(jest.fn().mockResolvedValue(undefined))
        await expect(
            handler.execute({ payload: { userId: 'u1' } } as never),
        ).resolves.toEqual({ success: true })
        expect(users.createCompleteCode).toHaveBeenCalledWith({ userId: 'u1' })
    })

    it('does not issue a code while mail is down', async () => {
        const { handler, users } = setup(
            jest.fn().mockRejectedValue(new Error('почта временно не работает')),
        )
        await expect(
            handler.execute({ payload: { userId: 'u1' } } as never),
        ).rejects.toThrow('почта временно не работает')
        expect(users.createCompleteCode).not.toHaveBeenCalled()
    })
})
