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
