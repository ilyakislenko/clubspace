import { IncomingMessage } from 'http'

export function extractToken(request: IncomingMessage): string | undefined {
    try {
        const authorization = request.headers.authorization

        if (authorization) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_, tokenFromHeaders] = authorization.split(' ')

            return tokenFromHeaders
        }
    } catch {
        // skip
    }

    try {
        // NOTE: this is a TYPE-only index — at runtime it's just `request`, so
        // this branch never reads connectionParams and always falls through.
        // Effectively dead; harmless because the realtime gateway extracts its
        // handshake token itself and nothing else relies on this fallback.
        const authorization = request as unknown as {
            connectionParams: { Authorization: string }
        }['connectionParams']['Authorization']

        if (authorization) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_, tokenFromHeaders] = authorization.split(' ')

            return tokenFromHeaders
        }
    } catch {
        // skip
    }

    return undefined
}
