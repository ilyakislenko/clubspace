import {
    ClubThrottlerGuard,
    JOIN_THROTTLE_MESSAGE,
    THROTTLE_MESSAGE,
    throttleErrorMessage,
} from './club-throttler.guard'

const guardWith = (verifyToken: jest.Mock) => {
    const guard = Object.create(ClubThrottlerGuard.prototype) as ClubThrottlerGuard
    Object.defineProperty(guard, 'tokens', { value: { verifyToken } })
    return guard as unknown as {
        getTracker: (req: Record<string, unknown>) => Promise<string>
    }
}

const req = (authorization?: string) => ({
    ip: '203.0.113.7',
    headers: authorization ? { authorization } : {},
})

describe('ClubThrottlerGuard.getTracker', () => {
    it('buckets a verified user by id, so one gym IP is not one shared bucket', async () => {
        const guard = guardWith(jest.fn().mockResolvedValue({ sub: 'u1' }))
        await expect(guard.getTracker(req('Bearer good'))).resolves.toBe('user:u1')
    })

    it('two students on the same Wi-Fi get separate buckets', async () => {
        const verify = jest
            .fn()
            .mockResolvedValueOnce({ sub: 'u1' })
            .mockResolvedValueOnce({ sub: 'u2' })
        const guard = guardWith(verify)
        const a = await guard.getTracker(req('Bearer a'))
        const b = await guard.getTracker(req('Bearer b'))
        expect(a).not.toBe(b)
    })

    it('falls back to the IP when there is no token', async () => {
        const verify = jest.fn()
        const guard = guardWith(verify)
        await expect(guard.getTracker(req())).resolves.toBe('ip:203.0.113.7')
        expect(verify).not.toHaveBeenCalled()
    })

    it('falls back to the IP for a forged/expired token — no fresh bucket for fakes', async () => {
        const guard = guardWith(jest.fn().mockRejectedValue(new Error('invalid signature')))
        await expect(guard.getTracker(req('Bearer forged'))).resolves.toBe('ip:203.0.113.7')
    })
})

describe('trackByClientIp', () => {
    it('is the IP even when the request carries a token', async () => {
        const { trackByClientIp } = await import('./club-throttler.guard')
        expect(trackByClientIp(req('Bearer good'))).toBe('ip:203.0.113.7')
    })
})

describe('throttleErrorMessage', () => {
    const ctx = (name: string) =>
        ({ getHandler: () => ({ name }) }) as never

    it('keeps the per-minute text for ordinary routes', () => {
        expect(throttleErrorMessage(ctx('signIn'))).toBe(THROTTLE_MESSAGE)
    })

    it('uses a neutral text on the join route (its address bucket is hourly)', () => {
        expect(throttleErrorMessage(ctx('joinWorkspaceByCode'))).toBe(
            JOIN_THROTTLE_MESSAGE,
        )
        expect(JOIN_THROTTLE_MESSAGE).toBe(
            'Слишком много попыток. Попробуйте позже.',
        )
    })
})
