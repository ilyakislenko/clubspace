import { IncomingMessage } from 'http'

import { extractToken } from './extract-token.util'

const req = (over: Record<string, unknown>): IncomingMessage =>
    ({ headers: {}, ...over }) as unknown as IncomingMessage

describe('extractToken', () => {
    it('returns the token after "Bearer " in the Authorization header', () => {
        expect(
            extractToken(req({ headers: { authorization: 'Bearer abc.def' } })),
        ).toBe('abc.def')
    })

    it('returns undefined when there is no Authorization header', () => {
        expect(extractToken(req({ headers: {} }))).toBeUndefined()
    })

    it('returns undefined for a scheme-less header (no space)', () => {
        // "abc" has no scheme prefix → nothing after the split.
        expect(
            extractToken(req({ headers: { authorization: 'rawtoken' } })),
        ).toBeUndefined()
    })

    it('reads the token from the header even if connectionParams is present', () => {
        expect(
            extractToken(
                req({
                    headers: { authorization: 'Bearer from.header' },
                    connectionParams: { Authorization: 'Bearer from.params' },
                }),
            ),
        ).toBe('from.header')
    })

    // Documents current behaviour: the connectionParams branch is a TYPE-only
    // index (`request as ...['connectionParams']['Authorization']`), a no-op at
    // runtime, so it never actually reads connectionParams — it returns
    // undefined. Harmless today: the realtime gateway reads the handshake token
    // directly and doesn't use this util. Kept as a regression guard.
    it('does NOT extract from connectionParams (dead type-only branch)', () => {
        expect(
            extractToken(
                req({
                    headers: {},
                    connectionParams: { Authorization: 'Bearer ws.token' },
                }),
            ),
        ).toBeUndefined()
    })
})
